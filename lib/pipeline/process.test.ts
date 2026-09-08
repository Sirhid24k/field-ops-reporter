import { describe, expect, it } from "vitest";
import { RetryableError, UnrecoverableError } from "./errors";
import { decideSettlement, LostClaimError } from "./process";
import { MAX_REQUEUES } from "./sweep";

describe("decideSettlement", () => {
  it("requeues a retryable failure and counts it", () => {
    expect(decideSettlement(new RetryableError("Gemini is rate limited or unavailable (429). Will retry. (gave up after 3 attempts)"), "extracting", 0)).toEqual({
      action: "requeue",
      requeueCount: 1,
      reason: "Gemini is rate limited or unavailable (429). Will retry. (gave up after 3 attempts)",
    });
    expect(decideSettlement(new RetryableError("no time left"), "transcribing", 2)).toMatchObject({ action: "requeue", requeueCount: 3 });
  });

  it("fails on the strike after the last allowed requeue, keeping the reason", () => {
    const settlement = decideSettlement(new RetryableError("Could not reach Gemini: fetch failed"), "extracting", MAX_REQUEUES);
    expect(settlement.action).toBe("fail");
    expect(settlement).toMatchObject({
      message: `Processing did not finish after ${MAX_REQUEUES} retries (stuck at extracting): Could not reach Gemini: fetch failed`,
    });
  });

  it("requeues an unexpected error too, bounded the same way", () => {
    expect(decideSettlement(new Error("Could not save report x: connection reset"), "validating", 1)).toEqual({
      action: "requeue",
      requeueCount: 2,
      reason: "Processing failed at validating: Could not save report x: connection reset",
    });
    expect(decideSettlement(new Error("boom"), "validating", MAX_REQUEUES).action).toBe("fail");
  });

  it("fails an unrecoverable error at once", () => {
    expect(decideSettlement(new UnrecoverableError("Nothing could be heard in the recording."), "transcribing", 0)).toEqual({
      action: "fail",
      message: "Nothing could be heard in the recording.",
    });
  });

  it("leaves a lost claim alone", () => {
    expect(decideSettlement(new LostClaimError("extracting"), "extracting", 0)).toEqual({ action: "skip", reason: "lost the claim at extracting" });
  });
});
