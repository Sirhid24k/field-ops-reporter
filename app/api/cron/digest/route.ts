import { runDigestCron } from "@/lib/pipeline/digest";
import { isInternalRequest } from "@/lib/pipeline/internal";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/digest — every 15 minutes (vercel.json). For each organisation whose local
 * time is past its report cutoff and that has no digest for its local date yet: raise the
 * missing-report alerts, then generate the digest. A rate-limited model call leaves the
 * org for the next run ("deferred"); nothing is written half-done.
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
