import { errorMessage } from "@/lib/pipeline/errors";
import { isInternalRequest } from "@/lib/pipeline/internal";
import { logPipeline } from "@/lib/pipeline/log";
import { processReport, type ProcessOutcome } from "@/lib/pipeline/process";
import { sweepStuckReports } from "@/lib/pipeline/sweep";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/sweep — every minute (vercel.json). Guarded by CRON_SECRET, which Vercel
 * sends as `Authorization: Bearer`. Re-queues reports stuck in a moving status for more
 * than three minutes (three strikes → failed) and processes them inline, oldest first,
 * within the function's time budget; whatever is left is still `queued` for the next run.
 *
 * Vercel's Hobby plan only runs crons once a day. That is why /api/process also sweeps
 * on every call: with drivers sending reports, stuck ones get retried within minutes
 * anyway; on a quiet day the daily cron still catches them.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500, headers: NO_STORE });
  if (!isInternalRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });

  const started = Date.now();
  const db = createAdminClient();
  const swept = await sweepStuckReports(db);

  const processed: Array<{ id: string } & ProcessOutcome> = [];
  const leftover: string[] = [];
  for (const id of swept.requeued) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      leftover.push(id);
      continue;
    }
    try {
      processed.push({ id, ...(await processReport(db, id)) });
    } catch (error) {
      logPipeline({ step: "process", reportId: id, outcome: "crashed", error: errorMessage(error) });
      processed.push({ id, outcome: "failed", error: errorMessage(error) });
    }
  }

  return Response.json({ requeued: swept.requeued, failed: swept.failed, processed, leftover, ms: Date.now() - started }, { headers: NO_STORE });
}
