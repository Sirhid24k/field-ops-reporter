import { timingSafeEqual } from "node:crypto";
import { publicEnv } from "@/lib/env";
import { errorMessage } from "./errors";
import { logPipeline } from "./log";

/**
 * The internal HTTP boundary: /api/process and /api/cron/* accept a request only with
 * CRON_SECRET (Vercel sends it as `Authorization: Bearer …` on cron invocations; our own
 * triggers send the same header). The field actions call `triggerProcessing` from
 * `after()` so the driver's request returns first and the pipeline starts a moment later
 * in its own invocation.
 */

/** True when the request carries CRON_SECRET (Bearer or x-cron-secret). False when the secret is not configured. */
export function isInternalRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get("authorization");
  const presented = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : request.headers.get("x-cron-secret")?.trim();
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Where this deployment reaches itself. PIPELINE_BASE_URL overrides; on Vercel the
 * deployment's own URL (so a preview never posts to production); locally the app URL.
 */
export function internalBaseUrl(): string {
  const explicit = process.env.PIPELINE_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return publicEnv.appUrl;
}

const TRIGGER_TIMEOUT_MS = 10_000;

/** POST /api/process for one report, fire-and-forget: logs instead of throwing. */
export async function triggerProcessing(reportId: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logPipeline({ step: "trigger", reportId, outcome: "skipped", reason: "CRON_SECRET is not set; the sweep will pick the report up" });
    return false;
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  // Vercel deployment protection on previews: let the self-call through
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  try {
    const response = await fetch(`${internalBaseUrl()}/api/process`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reportId }),
      cache: "no-store",
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
    });
    logPipeline({ step: "trigger", reportId, outcome: response.ok ? "ok" : "rejected", status: response.status });
    return response.ok;
  } catch (error) {
    logPipeline({ step: "trigger", reportId, outcome: "error", error: errorMessage(error) });
    return false;
  }
}
