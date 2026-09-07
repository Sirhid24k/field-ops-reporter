import { runDigestCron } from "@/lib/pipeline/digest";
import { isInternalRequest } from "@/lib/pipeline/internal";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/digest — once a day at 19:30 UTC (vercel.json). Vercel Hobby only allows
 * daily crons and fires them anywhere within the scheduled hour, so this lands between
 * 20:30 and 21:29 Africa/Lagos: after the demo org's 20:00 cutoff either way. One pass closes
 * the latest reporting day for every organisation (today after its cutoff, else yesterday),
 * skips orgs already generated, and raises the missing-report alerts in the same pass. A
 * rate-limited model call leaves the org for the next run ("deferred"); nothing is written
 * half-done. Demos and organisations whose cutoff is later than the cron hour use on-demand
 * generation from the dashboard (`generateDigestNow`, the same lib).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500, headers: NO_STORE });
  if (!isInternalRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });

  const started = Date.now();
  const outcomes = await runDigestCron(createAdminClient());
  return Response.json({ outcomes, ms: Date.now() - started }, { headers: NO_STORE });
}
