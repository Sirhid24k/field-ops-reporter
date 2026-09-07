import { after } from "next/server";
import { z } from "zod";
import { errorMessage } from "@/lib/pipeline/errors";
import { isInternalRequest, triggerProcessing } from "@/lib/pipeline/internal";
import { logPipeline } from "@/lib/pipeline/log";
import { processReport } from "@/lib/pipeline/process";
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
 * The stuck-report sweep also runs here first, so on a Vercel plan without minute crons
 * every new report still gives stuck ones another go.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

const bodySchema = z.object({
  reportId: z.uuid(),
  wait: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500, headers: NO_STORE });
  if (!isInternalRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as { reportId?: unknown; wait?: unknown } | null;
  const parsed = bodySchema.safeParse({
    reportId: body?.reportId ?? url.searchParams.get("report_id") ?? url.searchParams.get("reportId") ?? undefined,
    wait: typeof body?.wait === "boolean" ? body.wait : url.searchParams.get("wait") === "1",
  });
  if (!parsed.success) return Response.json({ error: "reportId (uuid) is required." }, { status: 400, headers: NO_STORE });
  const { reportId, wait } = parsed.data;

  const db = createAdminClient();

  if (wait) {
    const outcome = await processReport(db, reportId);
    return Response.json(outcome, { headers: NO_STORE });
  }

  const origin = await getRequestOrigin(); // the swept reports are triggered on this same deployment

  after(async () => {
    try {
      const swept = await sweepStuckReports(db);
      await Promise.all(swept.requeued.filter((id) => id !== reportId).map((id) => triggerProcessing(id, { origin })));
    } catch (error) {
      logPipeline({ step: "sweep", outcome: "error", error: errorMessage(error) });
    }
    try {
      await processReport(db, reportId);
    } catch (error) {
      logPipeline({ step: "process", reportId, outcome: "crashed", error: errorMessage(error) });
    }
  });

  return Response.json({ accepted: true, reportId }, { status: 202, headers: NO_STORE });
}
