// Generates the daily digest for an organisation inline and prints it, with the totals
// recomputed straight from the rows so they can be checked against the stats.
//
//   npm run digest:test -- [YYYY-MM-DD] [--org "Demo Haulage Ltd"] [--no-missing-alerts]
//
// Uses the service role; local only. Upserts daily_digests for (org, date) like the cron does.
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env"; // CommonJS package: default import, then destructure
import { generateDigest, localClock } from "../lib/pipeline/digest";
import type { Database } from "../lib/supabase/types";

nextEnv.loadEnvConfig(process.cwd(), true);

const args = process.argv.slice(2);
const orgIndex = args.indexOf("--org");
const orgName = orgIndex >= 0 ? args[orgIndex + 1] : "Demo Haulage Ltd";
const withMissingAlerts = !args.includes("--no-missing-alerts");
const dateArg = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}
const db = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data: org } = await db
  .from("organizations")
  .select("id, name, timezone, report_cutoff_time")
  .eq("name", orgName)
  .maybeSingle();
if (!org) {
  console.error(`No organisation named "${orgName}"`);
  process.exit(1);
}
const date = dateArg ?? localClock(org.timezone, new Date()).date;
console.log(`${org.name} (${org.timezone}, cutoff ${org.report_cutoff_time}), digest for ${date}${withMissingAlerts ? "" : ", no missing-report alerts"}`);

const started = Date.now();
const result = await generateDigest(db, org, date, { withMissingAlerts });
console.log(`\n--- ${result.source} in ${((Date.now() - started) / 1000).toFixed(1)}s ---\n`);
console.log(result.content_md);
console.log(`\nstats: ${JSON.stringify(result.data.stats)}`);

// cross-check: the same totals straight from the rows the digest counted
const { data: rows } = await db
  .from("reports")
  .select("vehicle_id, status, distance_km, fuel_liters")
  .eq("org_id", org.id)
  .eq("report_date", date);
const counted = (rows ?? []).filter((row) => row.status === "ready" || row.status === "reviewed");
const reported = new Set((rows ?? []).filter((row) => ["ready", "reviewed", "needs_clarification"].includes(row.status)).map((row) => row.vehicle_id));
const check = {
  reported: reported.size,
  total_km: Math.round(counted.reduce((sum, row) => sum + (row.distance_km ?? 0), 0) * 10) / 10,
  total_fuel_l: Math.round(counted.reduce((sum, row) => sum + (row.fuel_liters ?? 0), 0) * 10) / 10,
};
const matches = check.reported === result.data.stats.reported && check.total_km === result.data.stats.total_km && check.total_fuel_l === result.data.stats.total_fuel_l;
console.log(`row check: ${JSON.stringify(check)} → ${matches ? "matches" : "MISMATCH"}`);

const { data: stored } = await db.from("daily_digests").select("id, generated_at, stats").eq("org_id", org.id).eq("digest_date", date).maybeSingle();
console.log(`stored: ${JSON.stringify(stored)}`);
process.exit(matches ? 0 : 1);
