/**
 * The pipeline sorts every failure into one of two kinds:
 *
 *   RetryableError     a provider said "not now" (rate limit, overload, network). The
 *                      report goes back to `queued` and the sweep re-runs it later. A rate
 *                      limit is never grounds for `failed`.
 *   UnrecoverableError this report cannot succeed on a retry (silent audio, a schema the
 *                      model could not satisfy twice, bad configuration). The report is
 *                      marked `failed` with the message in `error`.
 *
 * Anything else that is thrown is treated as retryable once by the sweep's bounded
 * re-queue, which is what "survives crashes and re-runs" means in practice.
 */

export class RetryableError extends Error {
  readonly retryAfterMs: number | null;

  constructor(message: string, options: { retryAfterMs?: number | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "RetryableError";
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export class UnrecoverableError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "UnrecoverableError";
  }
}

/** Model output that did not fit the schema; `detail` is what the model sent, for the retry prompt. */
export class ModelOutputError extends Error {
  readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.name = "ModelOutputError";
    this.detail = detail;
  }
}

/** 429 (quota), 408/425 (timeouts), 5xx (overloaded or broken upstream). */
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number | null | undefined): boolean {
  return typeof status === "number" && RETRYABLE_HTTP_STATUSES.has(status);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
