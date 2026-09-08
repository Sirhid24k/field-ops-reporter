import { RetryableError } from "./errors";
import { logPipeline, timer } from "./log";

/**
 * Retries inside one invocation, with a deadline. A provider that says "not now" (429, 5xx,
 * a dropped connection, a timed-out attempt) is tried again after 5 s, 7.5 s, 10 s, up to
 * three attempts in all, but never past the invocation's deadline: an attempt that could not
 * finish before the function is killed is not started. The caller then requeues the report
 * (lib/pipeline/process.ts) and the next invocation gets a fresh budget, so a slow provider
 * costs a retrigger, never a report stuck in a moving status.
 */

export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 5_000;
export const RETRY_MAX_DELAY_MS = 10_000;
/** A Retry-After longer than this is not worth waiting for in one invocation. */
export const RETRY_AFTER_CAP_MS = 30_000;
/** The least time an attempt needs; with less than this left, the run gives up and requeues. */
export const MIN_ATTEMPT_MS = 8_000;

export type RetryOptions = {
  /** What is being retried, for the log line: "stt", "extract". */
  label: string;
  reportId?: string;
  /** Attempts in total, including the first. */
  attempts?: number;
  /** Epoch milliseconds after which nothing may still be running; null or undefined = no limit. */
  deadlineAt?: number | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type Attempt = {
  /** 1 for the first try. */
  number: number;
  /** Milliseconds until the deadline, or null without one. Size the attempt's own timeout from it. */
  remainingMs: number | null;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff before retry `retry` (1 for the first retry): 5 s, 7.5 s, 10 s; a longer Retry-After wins, capped. */
export function backoffDelayMs(retry: number, retryAfterMs: number | null = null): number {
  const backoff = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 1.5 ** Math.max(0, retry - 1));
  const asked = retryAfterMs !== null && Number.isFinite(retryAfterMs) ? Math.min(retryAfterMs, RETRY_AFTER_CAP_MS) : 0;
  return Math.max(backoff, asked);
}

/** A per-attempt timeout that also fits what is left of the run (a second is kept back for bookkeeping). */
export function attemptTimeoutMs(preferredMs: number, remainingMs: number | null): number {
  if (remainingMs === null) return preferredMs;
  return Math.max(1_000, Math.min(preferredMs, remainingMs - 1_000));
}

/**
 * Runs `fn` until it returns, throwing on the first error that is not a RetryableError, on
 * the last attempt, or when the deadline leaves no room for another attempt. A deadline
 * failure is rethrown as a RetryableError so the caller requeues rather than fails.
 */
export async function withRetries<T>(fn: (attempt: Attempt) => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? RETRY_ATTEMPTS);
  const wait = options.sleep ?? sleep;
  const now = options.now ?? Date.now;
  const deadlineAt = options.deadlineAt ?? null;
  const remaining = () => (deadlineAt === null ? null : deadlineAt - now());

  for (let attempt = 1; ; attempt++) {
    const left = remaining();
    if (left !== null && left < MIN_ATTEMPT_MS) {
      logPipeline({ step: `${options.label}.attempt`, reportId: options.reportId, attempt, outcome: "not_started", remainingMs: left });
      throw new RetryableError(`${options.label}: not enough time left in this run to start attempt ${attempt} (${left} ms).`);
    }

    const elapsed = timer();
    try {
      return await fn({ number: attempt, remainingMs: left });
    } catch (error) {
      if (!(error instanceof RetryableError)) throw error;
      const ms = elapsed();

      if (attempt >= attempts) {
        logPipeline({ step: `${options.label}.attempt`, reportId: options.reportId, attempt, outcome: "gave_up", ms, error: error.message });
        throw new RetryableError(`${error.message} (gave up after ${attempt} attempts)`, { retryAfterMs: error.retryAfterMs, cause: error });
      }

      const delay = backoffDelayMs(attempt, error.retryAfterMs);
      const leftNow = remaining();
      if (leftNow !== null && delay + MIN_ATTEMPT_MS > leftNow) {
        logPipeline({ step: `${options.label}.attempt`, reportId: options.reportId, attempt, outcome: "gave_up", ms, delayMs: delay, remainingMs: leftNow, error: error.message });
        throw new RetryableError(`${error.message} (gave up after ${attempt} attempt${attempt === 1 ? "" : "s"}: not enough time left in this run for another)`, {
          retryAfterMs: error.retryAfterMs,
          cause: error,
        });
      }

      logPipeline({ step: `${options.label}.attempt`, reportId: options.reportId, attempt, outcome: "retry", ms, delayMs: delay, error: error.message });
      await wait(delay);
    }
  }
}
