import { describe, expect, it } from "vitest";
import type { PipelineDb } from "./db";
import { RetryableError, UnrecoverableError } from "./errors";
import { decideSettlement, LostClaimError, replaceAlerts } from "./process";
import { MAX_REQUEUES } from "./sweep";
import type { AlertDraft } from "./validate";

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

// ---------------------------------------------------------------------------
// replaceAlerts: the alert side of a re-check after a supervisor edits a field
// ---------------------------------------------------------------------------

type AlertRow = { id: string; report_id: string; type: string; status: "open" | "acknowledged"; severity?: string; message?: string };
type QueryResult = { data: AlertRow[]; error: null };
type Query = { eq(column: string, value: unknown): Query; then(resolve: (value: QueryResult) => void): void };

/** Just enough of the alerts table for replaceAlerts: select/delete filtered by eq, and insert. */
function fakeAlertsDb(rows: AlertRow[]) {
  const state = { rows: rows.map((row) => ({ ...row })), deleted: [] as AlertRow[], inserted: [] as Array<Record<string, unknown>> };
  let nextId = 100;
  const query = (kind: "select" | "delete"): Query => {
    const filters: Array<[string, unknown]> = [];
    const matches = (row: AlertRow) => filters.every(([column, value]) => (row as Record<string, unknown>)[column] === value);
    const builder: Query = {
      eq(column, value) {
        filters.push([column, value]);
        return builder;
      },
      then(resolve) {
        if (kind === "delete") {
          const gone = state.rows.filter(matches);
          state.rows = state.rows.filter((row) => !matches(row));
          state.deleted.push(...gone);
          resolve({ data: gone, error: null });
        } else {
          resolve({ data: state.rows.filter(matches), error: null });
        }
      },
    };
    return builder;
  };
  const db = {
    from: () => ({
      select: () => query("select"),
      delete: () => query("delete"),
      insert: async (inserted: Array<Record<string, unknown>>) => {
        state.inserted.push(...inserted);
        for (const row of inserted) state.rows.push({ id: `a${nextId++}`, status: "open", ...(row as Omit<AlertRow, "id" | "status">) });
        return { error: null };
      },
    }),
  } as unknown as PipelineDb;
  return { db, state };
}

describe("replaceAlerts (the re-check after a supervisor edit)", () => {
  const report = { id: "r1", org_id: "o1", vehicle_id: "v1" };

  it("clears the open jump and fuel alerts when the corrected numbers pass", async () => {
    const { db, state } = fakeAlertsDb([
      { id: "a1", report_id: "r1", type: "odometer_jump", status: "open" },
      { id: "a2", report_id: "r1", type: "fuel_outlier", status: "open" },
    ]);
    expect(await replaceAlerts(db, report, [])).toBe(0);
    expect(state.deleted.map((row) => row.id)).toEqual(["a1", "a2"]);
    expect(state.inserted).toEqual([]);
    expect(state.rows).toEqual([]);
  });

  it("raises the alert when an edit introduces a failure", async () => {
    const { db, state } = fakeAlertsDb([]);
    const drafts: AlertDraft[] = [{ type: "fuel_outlier", severity: "medium", message: "Fuel use 1.2 km/L, expected 2.7–6.3." }];
    expect(await replaceAlerts(db, report, drafts)).toBe(1);
    expect(state.inserted).toEqual([
      { org_id: "o1", report_id: "r1", vehicle_id: "v1", type: "fuel_outlier", severity: "medium", message: "Fuel use 1.2 km/L, expected 2.7–6.3." },
    ]);
  });

  it("never resurrects an acknowledged alert, and only touches this report's open ones", async () => {
    const { db, state } = fakeAlertsDb([
      { id: "a1", report_id: "r1", type: "fuel_outlier", status: "acknowledged" },
      { id: "a2", report_id: "r1", type: "odometer_jump", status: "open" },
      { id: "a3", report_id: "other", type: "odometer_jump", status: "open" },
    ]);
    const drafts: AlertDraft[] = [
      { type: "fuel_outlier", severity: "medium", message: "Fuel use 1.4 km/L after the edit, expected 2.7–6.3." },
      { type: "duplicate", severity: "medium", message: "Another report for this vehicle on this date was already sent." },
    ];
    expect(await replaceAlerts(db, report, drafts)).toBe(1);
    expect(state.deleted.map((row) => row.id)).toEqual(["a2"]);
    expect(state.inserted.map((row) => row.type)).toEqual(["duplicate"]);
    expect(state.rows.find((row) => row.id === "a1")).toMatchObject({ type: "fuel_outlier", status: "acknowledged" });
    expect(state.rows.find((row) => row.id === "a3")).toMatchObject({ report_id: "other", status: "open" });
  });
});
