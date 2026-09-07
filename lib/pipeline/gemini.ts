import { ApiError, GoogleGenAI, type Schema } from "@google/genai";
import { errorMessage, isRetryableStatus, ModelOutputError, RetryableError, UnrecoverableError } from "./errors";

/**
 * The only place that talks to Gemini. Two callers: extraction (structured JSON) and the
 * digest (markdown). Model IDs come from EXTRACTION_MODEL / DIGEST_MODEL; the default
 * matches .env.example and is never used in a call site.
 */

const DEFAULT_MODEL = "gemini-3.5-flash";

let client: GoogleGenAI | null = null;

function gemini(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new UnrecoverableError("Missing environment variable GEMINI_API_KEY (server-only).");
    client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 60_000,
        // A few quick in-process retries cover a blip; a real quota hit still comes back as a
        // 429, which becomes a RetryableError and the sweep re-runs the report minutes later.
        retryOptions: { attempts: 3, initialDelay: 2, maxDelay: 6, httpStatusCodes: [408, 429, 500, 502, 503, 504] },
      },
    });
  }
  return client;
}

export function modelFor(purpose: "extraction" | "digest"): string {
  const configured = purpose === "extraction" ? process.env.EXTRACTION_MODEL : process.env.DIGEST_MODEL;
  return configured?.trim() || DEFAULT_MODEL;
}

export type GenerateOptions = {
  model: string;
  system: string;
  prompt: string;
  /** Structured output: `responseMimeType: "application/json"` plus this `responseSchema`. */
  schema?: Schema;
  temperature?: number;
};

/** One generateContent call; the model's text, or a typed error the pipeline knows how to route. */
export async function generateText(options: GenerateOptions): Promise<string> {
  let response;
  try {
    response = await gemini().models.generateContent({
      model: options.model,
      contents: options.prompt,
      config: {
        systemInstruction: options.system,
        temperature: options.temperature ?? 0.2,
        ...(options.schema ? { responseMimeType: "application/json", responseSchema: options.schema } : {}),
      },
    });
  } catch (error) {
    throw translate(error, options.model);
  }

  const text = response.text?.trim();
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason ?? "no candidates";
    throw new UnrecoverableError(`Gemini ${options.model} returned no text (${reason}).`);
  }
  return text;
}

/** generateText with structured output, parsed. A non-JSON reply is a ModelOutputError so the caller can retry once. */
export async function generateJson(options: GenerateOptions & { schema: Schema }): Promise<unknown> {
  const text = await generateText(options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ModelOutputError("The model did not return valid JSON.", text.slice(0, 2_000));
  }
}

function translate(error: unknown, model: string): Error {
  if (error instanceof ApiError) {
    if (isRetryableStatus(error.status)) {
      return new RetryableError(`Gemini ${model} is rate limited or unavailable (${error.status}). Will retry.`, { cause: error });
    }
    return new UnrecoverableError(`Gemini ${model} rejected the request (${error.status}): ${error.message}`, { cause: error });
  }
  // fetch failures and aborted timeouts: worth another go later
  return new RetryableError(`Could not reach Gemini: ${errorMessage(error)}`, { cause: error });
}
