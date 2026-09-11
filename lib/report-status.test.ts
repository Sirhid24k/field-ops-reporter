import { describe, expect, it } from "vitest";
import { olderReportsWaiting, type WaitingReport } from "./report-status";

const row = (id: string, report_date: string, status: WaitingReport["status"], open_questions = 1): WaitingReport => ({ id, report_date, status, open_questions });

describe("olderReportsWaiting", () => {
  const today = "2026-09-11";

  it("finds nothing when no earlier report is waiting for an answer", () => {
    expect(olderReportsWaiting([], today)).toBeNull();
    expect(olderReportsWaiting([row("a", "2026-09-10", "ready"), row("b", "2026-09-09", "reviewed"), row("c", "2026-09-08", "rejected")], today)).toBeNull();
  });

  it("leaves today's report to Today's own card", () => {
    expect(olderReportsWaiting([row("a", today, "needs_clarification")], today)).toBeNull();
  });

  it("returns the oldest waiting report and how many are waiting in all", () => {
    const result = olderReportsWaiting(
      [row("newer", "2026-09-10", "needs_clarification", 2), row("today", today, "needs_clarification"), row("older", "2026-09-08", "needs_clarification"), row("done", "2026-09-07", "reviewed")],
      today,
    );
    expect(result).toEqual({ oldest: row("older", "2026-09-08", "needs_clarification"), waiting: 2 });
  });

  it("ignores a report whose questions have all been answered, and orders same-day reports by id", () => {
    const result = olderReportsWaiting(
      [row("b", "2026-09-09", "needs_clarification"), row("answered", "2026-09-08", "needs_clarification", 0), row("a", "2026-09-09", "needs_clarification")],
      today,
    );
    expect(result).toEqual({ oldest: row("a", "2026-09-09", "needs_clarification"), waiting: 2 });
  });
});
