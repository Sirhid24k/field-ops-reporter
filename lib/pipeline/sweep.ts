import { MOVING_STATUSES } from "@/lib/report-status";
import type { PipelineDb } from "./db";
import { logPipeline } from "./log";
import { moveReportStatus } from "./status";

/**
 * The sweep (spec §5): anything that has sat in a moving status for more than three
 * minutes is put back to `queued` for another run. A report caught mid-flight
 * (transcribing / extracting / validating, i.e. a crashed or timed-out worker) counts
 * as a retry; after MAX_REQUEUES of those it is marked `failed`. A report that is merely
 * `queued` (its trigger never fired, or a rate limit sent it back) is restarted without
 * counting, so a rate limit is never grounds for `failed`.
 *
 * Runs from /api/cron/sweep every minute and opportunistically at the top of
 * /api/process, for plans where a minute cron is not available.
 */

export const STUCK_AFTER_MS = 3 * 60_000;
export const MAX_REQUEUES = 3;
const BATCH = 50;

export type SweepResult = {
  /** Reports put back to `queued`; the caller decides whether to process them inline or trigger them. */
  requeued: string[];
  /** Reports that had used up their retries. */
  failed: string[];
};

export async function sweepStuckReports(db: PipelineDb, now: Date = new Date()): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
  const { data: rows, error } = await db
    .from("reports")
    .select("id, status, source, audio_path, requeue_count")
    .in("status", [...MOVING_STATUSES])
    .lt("status_changed_at", cutoff)
    .order("status_changed_at")
    .limit(BATCH);
  if (error) throw new Error(`Sweep could not read reports: ${error.message}`);

  const result: SweepResult = { requeued: [], failed: [] };
  for (const row of rows ?? []) {
    // a queued voice report without audio is still uploading from the phone; not ours yet
    if (row.source === "voice" && !row.audio_path) continue;

    if (row.status !== "queued" && row.requeue_count >= MAX_REQUEUES) {
      const message = `Processing did not finish after ${MAX_REQUEUES} retries (stuck at ${row.status}).`;
      if (await moveReportStatus(db, row.id, row.status, "failed", { error: message, processed_at: now.toISOString() })) {
        result.failed.push(row.id);
        logPipeline({ step: "sweep", reportId: row.id, outcome: "failed", from: row.status, requeueCount: row.requeue_count });
      }
      continue;
    }

    const requeueCount = row.status === "queued" ? row.requeue_count : row.requeue_count + 1;
    const moved = await moveReportStatus(db, row.id, row.status, "queued", {
      requeue_count: requeueCount,
      status_changed_at: now.toISOString(), // queued → queued does not fire the trigger
      error: null,
      processed_at: null,
    });
    if (moved) {
      result.requeued.push(row.id);
      logPipeline({ step: "sweep", reportId: row.id, outcome: "requeued", from: row.status, requeueCount });
    }
  }
  return result;
}
