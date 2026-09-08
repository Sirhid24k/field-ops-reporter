import { after } from "next/server";
import { z } from "zod";
import { errorMessage } from "@/lib/pipeline/errors";
import { isInternalRequest, triggerProcessing } from "@/lib/pipeline/internal";
import { logPipeline } from "@/lib/pipeline/log";
import { processReport, type ProcessOutcome } from "@/lib/pipeline/process";
import { sleep } from "@/lib/pipeline/retry";
import { sweepStuckReports } from "@/lib/pipeline/sweep";
import { getRequestOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/process  { reportId, wait? }   (or ?report_id=…&wait=1)
 * Internal: needs CRON_SECRET. Called fire-and-forget from the field actions (after the
 * audio is confirmed, after a typed report is saved, after an answer lands) and by the
 * sweep. Returns 202 at once and runs the pipeline in `after()`; `wait: true` runs it
 * inline and returns the outcome (the harness and manual checks use that).
 *
 * Time budget (Vercel Hobby, Fluid compute on): `maxDuration` bounds the whole invocation,
 * `after()` work included. The pipeline gets PROCESS_BUDGET_MS of it as a deadline, so a
 * slow or rate-limited provider makes the run give up in time and requeue the report rather
 * than being killed mid-step; the invocation then waits RETRIGGER_DELAY_MS and fires one more
 * /api/process for that report (bounded by the three-strike rule in lib/pipeline/process.ts).
 *
 * The stuck-report sweep also runs here first: Vercel Hobby only allows daily crons, so
 * every new report giving stuck ones another go is the real recovery path.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Deadline for the pipeline inside one invocation; leaves room for the sweep, the retrigger delay and the trigger call. */
const PROCESS_BUDGET_MS = 40_000;
const RETRIGGER_DELAY_MS = 5_000;

const NO_STORE = { "cache-control": "no-store" };

const bodySchema = z.object({
  reportId: z.uuid(),
  wait: z.boolean().optional(),
});

/** After a requeue, one more run for the report on this deployment, a moment later. */
async function retrigger(reportId: string, outcome: ProcessOutcome, origin: string): Promise<void> {
  if (outcome.outcome !== "requeued") return;
  logPipeline({ step: "retrigger", reportId, outcome: "scheduled", delayMs: RETRIGGER_DELAY_MS, requeueCount: outcome.requeueCount });
  await sleep(RETRIGGER_DELAY_MS);
  await triggerProcessing(reportId, { origin });
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500, headers: NO_STORE });
  if (!isInternalRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });

  const startedAt = Date.now();
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as { reportId?: unknown; wait?: unknown } | null;
  const parsed = bodySchema.safeParse({
    reportId: body?.reportId ?? url.searchParams.get("report_id") ?? url.searchParams.get("reportId") ?? undefined,
    wait: typeof body?.wait === "boolean" ? body.wait : url.searchParams.get("wait") === "1",
  });
  if (!parsed.success) return Response.json({ error: "reportId (uuid) is required." }, { status: 400, headers: NO_STORE });
  const { reportId, wait } = parsed.data;

  const db = createAdminClient();
  const deadlineAt = startedAt + PROCESS_BUDGET_MS;
  const origin = await getRequestOrigin(); // retriggers and swept reports run on this same deployment

  if (wait) {
    const outcome = await processReport(db, reportId, { deadlineAt });
    after(() => retrigger(reportId, outcome, origin));
    return Response.json(outcome, { headers: NO_STORE });
  }

  after(async () => {
    try {
      const swept = await sweepStuckReports(db);
      await Promise.all(swept.requeued.filter((id) => id !== reportId).map((id) => triggerProcessing(id, { origin })));
    } catch (error) {
      logPipeline({ step: "sweep", outcome: "error", error: errorMessage(error) });
    }
    try {
      const outcome = await processReport(db, reportId, { deadlineAt });
      await retrigger(reportId, outcome, origin);
    } catch (error) {
      logPipeline({ step: "process", reportId, outcome: "crashed", error: errorMessage(error), ms: Date.now() - startedAt });
    }
  });

  return Response.json({ accepted: true, reportId }, { status: 202, headers: NO_STORE });
}
