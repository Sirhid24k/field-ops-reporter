import { describe, expect, it, vi } from "vitest";
import { RetryableError, UnrecoverableError } from "./errors";
import { attemptTimeoutMs, backoffDelayMs, MIN_ATTEMPT_MS, withRetries } from "./retry";

function harness(deadlineAt: number | null = null) {
  let clock = 1_000_000;
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
    clock += ms;
  };
  const now = () => clock;
  const advance = (ms: number) => {
    clock += ms;
  };
  return { delays, sleep, now, advance, options: { label: "stt", reportId: "r1", deadlineAt, sleep, now } };
}

describe("backoff", () => {
  it("waits 5 s, 7.5 s, 10 s", () => {
    expect(backoffDelayMs(1)).toBe(5_000);
    expect(backoffDelayMs(2)).toBe(7_500);
    expect(backoffDelayMs(3)).toBe(10_000);
    expect(backoffDelayMs(9)).toBe(10_000);
  });

  it("honours a longer Retry-After, capped", () => {
    expect(backoffDelayMs(1, 8_000)).toBe(8_000);
    expect(backoffDelayMs(1, 2_000)).toBe(5_000);
    expect(backoffDelayMs(1, 120_000)).toBe(30_000);
  });

  it("fits an attempt's timeout to the time left", () => {
    expect(attemptTimeoutMs(25_000, null)).toBe(25_000);
    expect(attemptTimeoutMs(25_000, 40_000)).toBe(25_000);
    expect(attemptTimeoutMs(25_000, 10_000)).toBe(9_000);
    expect(attemptTimeoutMs(25_000, 500)).toBe(1_000);
  });
});

describe("withRetries", () => {
  it("returns the first success and tells the attempt how long it has", async () => {
    const { options, delays } = harness(1_000_000 + 40_000);
    const fn = vi.fn(async (attempt: { number: number; remainingMs: number | null }) => `ok ${attempt.number} ${attempt.remainingMs}`);
    await expect(withRetries(fn, options)).resolves.toBe("ok 1 40000");
    expect(delays).toEqual([]);
  });

  it("retries a retryable error up to three attempts with 5–10 s backoff", async () => {
    const { options, delays } = harness();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) throw new RetryableError(`busy ${calls}`);
      return "done";
    };
    await expect(withRetries(fn, options)).resolves.toBe("done");
    expect(calls).toBe(3);
    expect(delays).toEqual([5_000, 7_500]);
  });

  it("gives up after the last attempt with the reason", async () => {
    const { options, delays } = harness();
    const fn = async () => {
      throw new RetryableError("rate limited (429)");
    };
    await expect(withRetries(fn, options)).rejects.toMatchObject({ name: "RetryableError", message: "rate limited (429) (gave up after 3 attempts)" });
    expect(delays).toEqual([5_000, 7_500]);
  });

  it("does not retry an unrecoverable error", async () => {
    const { options, delays } = harness();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      throw new UnrecoverableError("silent recording");
    };
    await expect(withRetries(fn, options)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it("stops before the deadline instead of starting an attempt that cannot finish", async () => {
    // 20 s left: the first attempt fails after 10 s, leaving 10 s; 5 s backoff + an 8 s attempt does not fit
    const { options, delays, advance } = harness(1_000_000 + 20_000);
    let calls = 0;
    const fn = async () => {
      calls += 1;
      advance(10_000);
      throw new RetryableError("Gemini is overloaded (503)");
    };
    await expect(withRetries(fn, options)).rejects.toMatchObject({
      name: "RetryableError",
      message: "Gemini is overloaded (503) (gave up after 1 attempt: not enough time left in this run for another)",
    });
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it("refuses to start when less than the minimum attempt time is left", async () => {
    const { options } = harness(1_000_000 + MIN_ATTEMPT_MS - 1);
    const fn = vi.fn(async () => "never");
    await expect(withRetries(fn, options)).rejects.toBeInstanceOf(RetryableError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("waits for Retry-After when it fits", async () => {
    const { options, delays } = harness(1_000_000 + 60_000);
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls === 1) throw new RetryableError("429", { retryAfterMs: 9_000 });
      return "ok";
    };
    await expect(withRetries(fn, options)).resolves.toBe("ok");
    expect(delays).toEqual([9_000]);
  });
});
