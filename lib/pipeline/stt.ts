import { errorMessage, isRetryableStatus, RetryableError, UnrecoverableError } from "./errors";
import { attemptTimeoutMs, withRetries } from "./retry";

/**
 * Speech-to-text adapter. `STT_PROVIDER` picks the provider; only Groq (Whisper large v3,
 * OpenAI-compatible endpoint) is implemented, but the interface is what the pipeline
 * depends on, so another provider is one object in `PROVIDERS`.
 *
 * `language` on the way out is a display label ("English", "Pidgin", "Hausa"), or the
 * provider's own code when we have no label for it. Whisper has no Pidgin model, so a
 * Pidgin recording comes back tagged English; `languageLabel` re-labels it from the words.
 * Since the language is forced to English (below) this label is only a hint for the
 * extraction prompt; the stored `transcript_language` is set by the extraction model.
 */

export type RawTranscription = { text: string; language: string | null };
export type Transcription = { text: string; language: string };

export type ProviderCall = {
  /** Timeout for this one attempt; sized to the run's remaining budget by `transcribe`. */
  timeoutMs: number;
};

export interface SttProvider {
  readonly name: string;
  transcribe(audio: Buffer, mime: string, call: ProviderCall): Promise<RawTranscription>;
}

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_GROQ_MODEL = "whisper-large-v3";
/** One attempt on a three-minute clip finishes well inside this; the run's deadline can shorten it. */
export const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Whisper's `prompt` is a style guide (kept under 30 words): it biases the vocabulary toward
 * the domain, which improves digits and place names, and keeps Pidgin words instead of
 * "correcting" them.
 */
const VOCABULARY_PROMPT =
  "Nigerian truck driver's trip report. Odometer reading, litres of diesel, naira, checkpoint, Road Safety, wahala. " +
  "Lagos, Ibadan, Abuja, Kaduna, Kano, Zaria, Lokoja, Minna, Jos. Plate KTU 421 XA, T-25783-LA.";

/**
 * Whisper's language detector mislabels Nigerian-accented English (a plainly English report
 * came back as Yoruba), so every transcription is forced to English: drivers speak English or
 * Pidgin, and Whisper has no Pidgin model either way. Hausa stays on the roadmap.
 */
const FORCED_LANGUAGE = "en";

function bytesOf(audio: Buffer): ArrayBuffer {
  return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

const groq: SttProvider = {
  name: "groq",
  async transcribe(audio, mime, call) {
    const apiKey = process.env.STT_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey) throw new UnrecoverableError("Missing environment variable STT_API_KEY (server-only).");
    const model = process.env.STT_MODEL?.trim() || DEFAULT_GROQ_MODEL;

    const form = new FormData();
    form.append("file", new Blob([bytesOf(audio)], { type: mime }), `audio.${extensionForMime(mime)}`);
    form.append("model", model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    form.append("language", FORCED_LANGUAGE);
    form.append("prompt", VOCABULARY_PROMPT);

    let response: Response;
    try {
      response = await fetch(GROQ_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(call.timeoutMs),
      });
    } catch (error) {
      throw new RetryableError(`Could not reach Groq: ${errorMessage(error)}`, { cause: error });
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300);
      if (isRetryableStatus(response.status)) {
        throw new RetryableError(`Groq is rate limited or unavailable (${response.status}). Will retry.`, {
          retryAfterMs: retryAfterMs(response),
        });
      }
      throw new UnrecoverableError(`Groq rejected the audio (${response.status}): ${body}`);
    }

    const json = (await response.json()) as { text?: unknown; language?: unknown };
    return {
      text: typeof json.text === "string" ? json.text.trim() : "",
      language: typeof json.language === "string" && json.language.trim() ? json.language.trim() : null,
    };
  },
};

const PROVIDERS: Record<string, SttProvider> = { groq };

export function sttProvider(): SttProvider {
  const name = (process.env.STT_PROVIDER ?? "").trim().toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new UnrecoverableError(
      `STT_PROVIDER is "${name || "unset"}"; the implemented providers are: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return provider;
}

// ---------------------------------------------------------------------------
// containers
// ---------------------------------------------------------------------------

const MIME_BY_EXTENSION: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

/** MIME type from a storage path or file name, by extension (webm when unknown). */
export function mimeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "audio/webm";
}

export function extensionForMime(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  const match = Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === base);
  return match?.[0] ?? "webm";
}

// ---------------------------------------------------------------------------
// language labels
// ---------------------------------------------------------------------------

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  english: "English",
  pcm: "Pidgin",
  pidgin: "Pidgin",
  "nigerian pidgin": "Pidgin",
  ha: "Hausa",
  hausa: "Hausa",
  yo: "Yoruba",
  yoruba: "Yoruba",
  ig: "Igbo",
  igbo: "Igbo",
  fr: "French",
  french: "French",
};

/** Words that only occur in Nigerian Pidgin; a hit counts 1. */
const STRONG_MARKERS = ["wahala", "abeg", "wetin", "sabi", "una", "dey", "comot", "oga", "pikin", "kuku", "jare", "waka", "shey"];
/** Words Pidgin uses constantly but English also has (or nearly has); a hit counts half. */
const WEAK_MARKERS = ["na", "don", "wan", "dem", "sef", "sha", "abi", "chop", "yarn", "gist"];
const PHRASE_MARKERS = ["no be", "make we", "small small", "e don", "we don", "motor spoil", "no wahala", "i no", "e no"];
const PIDGIN_THRESHOLD = 2;

/** True when the transcript reads as Nigerian Pidgin rather than English. Deterministic word scoring. */
export function looksLikePidgin(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z'\s]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const words = new Set(normalized.split(" "));
  let score = 0;
  for (const marker of STRONG_MARKERS) if (words.has(marker)) score += 1;
  for (const marker of WEAK_MARKERS) if (words.has(marker)) score += 0.5;
  for (const phrase of PHRASE_MARKERS) if (normalized.includes(` ${phrase} `) || normalized.startsWith(`${phrase} `) || normalized.endsWith(` ${phrase}`)) score += 1;
  return score >= PIDGIN_THRESHOLD;
}

/** "english" → "English", "pcm" → "Pidgin", an unknown code stays as it is, nothing → "Unknown". */
export function languageLabel(providerLanguage: string | null, text: string): string {
  const key = providerLanguage?.trim().toLowerCase() ?? "";
  const label = key ? (LANGUAGE_LABELS[key] ?? providerLanguage!.trim()) : "Unknown";
  if ((label === "English" || label === "Unknown") && looksLikePidgin(text)) return "Pidgin";
  return label;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export type TranscribeOptions = {
  /** Epoch milliseconds after which nothing may still be running (the function's budget). */
  deadlineAt?: number | null;
  reportId?: string;
};

/**
 * One transcription with retries inside the run (lib/pipeline/retry.ts): a 429, a 5xx, a
 * dropped connection or a timed-out attempt is tried again after 5–10 s, up to three
 * attempts, never past the deadline.
 */
export async function transcribe(audio: Buffer, mime: string, options: TranscribeOptions = {}): Promise<Transcription> {
  const provider = sttProvider();
  const raw = await withRetries(
    (attempt) => provider.transcribe(audio, mime, { timeoutMs: attemptTimeoutMs(REQUEST_TIMEOUT_MS, attempt.remainingMs) }),
    { label: "stt", reportId: options.reportId, deadlineAt: options.deadlineAt },
  );
  return { text: raw.text, language: languageLabel(raw.language, raw.text) };
}
