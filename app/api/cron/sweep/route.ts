import { after } from "next/server";
import { errorMessage } from "@/lib/pipeline/errors";
import { isInternalRequest, triggerProcessing } from "@/lib/pipeline/internal";
import { logPipeline } from "@/lib/pipeline/log";
import { processReport, type ProcessOutcome } from "@/lib/pipeline/process";
import { sweepStuckReports } from "@/lib/pipeline/sweep";
import { getRequestOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/sweep — once a day at 03:00 UTC (vercel.json), an off-peak backstop. Guarded
 * by CRON_SECRET, which Vercel sends as `Authorization: Bearer`. Re-queues reports stuck in
 * a moving status for more than three minutes (three strikes → failed) and processes them
 * inline, oldest first, within the function's time budget; each run gets a deadline so one
 * slow provider cannot overrun the invocation. Whatever is still `queued` afterwards (a
 * leftover, or a run that gave up and requeued) is handed to /api/process on this
 * deployment, one invocation each.
 *
 * Vercel Hobby only allows daily crons and fires them anywhere within the scheduled hour,
 * so the real recovery path is the inline sweep at the top of every /api/process call: with
 * drivers sending reports, stuck ones get retried within minutes; on a quiet day this cron
 * still catches them.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500, headers: NO_STORE });
  if (!isInternalRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });

  const started = Date.now();
  const deadlineAt = started + TIME_BUDGET_MS;
  const origin = await getRequestOrigin();
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
      processed.push({ id, ...(await processReport(db, id, { deadlineAt })) });
    } catch (error) {
      logPipeline({ step: "process", reportId: id, outcome: "crashed", error: errorMessage(error) });
      processed.push({ id, outcome: "failed", error: errorMessage(error) });
    }
  }

  // still queued: leftovers, and runs that gave up and requeued; give each its own invocation
  const stillQueued = [...leftover, ...processed.filter((entry) => entry.outcome === "requeued").map((entry) => entry.id)];
  if (stillQueued.length > 0) {
    after(async () => {
      await Promise.all(stillQueued.map((id) => triggerProcessing(id, { origin })));
    });
  }

  return Response.json({ requeued: swept.requeued, failed: swept.failed, processed, leftover, retriggered: stillQueued, ms: Date.now() - started }, { headers: NO_STORE });
}
