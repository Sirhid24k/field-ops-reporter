// Proves the RLS policies with real user JWTs.
//   npm run rls:proof -- <admin-email> <field-email>
// Both users must already exist with profiles in the same org (sign up + join through the app first).
// Seeds a hypothetical report + alert for the admin, checks what each user can see and do,
// then removes what it created. Exit code 1 if any check fails.
import { randomUUID } from "node:crypto";
import { createClient, type EmailOtpType, type SupabaseClient } from "@supabase/supabase-js";
import nextEnv from "@next/env"; // CommonJS package: default import, then destructure
import type { Database } from "../lib/supabase/types";

nextEnv.loadEnvConfig(process.cwd(), true);

const [adminEmail, fieldEmail] = process.argv.slice(2);
if (!adminEmail || !fieldEmail) {
  console.error("usage: npm run rls:proof -- <admin-email> <field-email>");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !anonKey || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

type Client = SupabaseClient<Database>;
const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin: Client = createClient<Database>(url, serviceRoleKey, noSession);

/** A client signed in as `email`, via an admin-generated token hash (no email is sent). */
async function clientAs(email: string): Promise<Client> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties) throw new Error(`generateLink(${email}): ${error?.message}`);
  const client: Client = createClient<Database>(url, anonKey, noSession);
  const { error: verifyError } = await client.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: data.properties.verification_type as EmailOtpType,
  });
  if (verifyError) throw new Error(`verifyOtp(${email}): ${verifyError.message}`);
  return client;
}

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
}

async function profileFor(email: string) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`No auth user for ${email}`);
  const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) throw new Error(`No profile for ${email}. Finish onboarding / the invite first.`);
  return profile;
}

const adminProfile = await profileFor(adminEmail);
const fieldProfile = await profileFor(fieldEmail);
if (adminProfile.org_id !== fieldProfile.org_id) throw new Error("The two users are not in the same org.");
if (fieldProfile.role !== "field") throw new Error(`${fieldEmail} is not a field user.`);
if (!["admin", "supervisor"].includes(adminProfile.role)) throw new Error(`${adminEmail} is not staff.`);
const orgId = adminProfile.org_id;

// --- seed hypothetical rows with the service role -------------------------------------------
let vehicleId: string;
let createdVehicle = false;
const { data: existingVehicle } = await admin.from("vehicles").select("id").eq("org_id", orgId).limit(1).maybeSingle();
if (existingVehicle) {
  vehicleId = existingVehicle.id;
} else {
  const { data: vehicle, error } = await admin
    .from("vehicles")
    .insert({ org_id: orgId, plate_number: "RLS PROOF", label: "temporary" })
    .select("id")
    .single();
  if (error || !vehicle) throw new Error(`seed vehicle: ${error?.message}`);
  vehicleId = vehicle.id;
  createdVehicle = true;
}

const seedClientUuid = randomUUID();
const { data: seededReport, error: seedError } = await admin
  .from("reports")
  .insert({
    client_uuid: seedClientUuid,
    org_id: orgId,
    user_id: adminProfile.id,
    vehicle_id: vehicleId,
    report_date: new Date().toISOString().slice(0, 10),
    source: "text",
    typed_note: "RLS proof: hypothetical report belonging to the admin",
    status: "ready",
  })
  .select("id")
  .single();
if (seedError || !seededReport) throw new Error(`seed report: ${seedError?.message}`);

const { data: seededAlert, error: alertError } = await admin
  .from("alerts")
  .insert({
    org_id: orgId,
    report_id: seededReport.id,
    vehicle_id: vehicleId,
    type: "fuel_outlier",
    severity: "medium",
    message: "RLS proof: hypothetical alert",
  })
  .select("id")
  .single();
if (alertError || !seededAlert) throw new Error(`seed alert: ${alertError?.message}`);

const cleanupIds = { reports: [seededReport.id] as string[] };

try {
  const field = await clientAs(fieldEmail);
  const staff = await clientAs(adminEmail);

  // --- field user ---------------------------------------------------------------------------
  const { data: fieldReports } = await field.from("reports").select("id, user_id");
  const foreign = (fieldReports ?? []).filter((r) => r.user_id !== fieldProfile.id);
  check("field: other users' reports are invisible", foreign.length === 0, `${foreign.length} foreign rows, ${fieldReports?.length ?? 0} total`);
  check("field: the seeded admin report is invisible", !(fieldReports ?? []).some((r) => r.id === seededReport.id), "");

  const { data: fieldAlerts } = await field.from("alerts").select("id");
  check("field: alerts return zero rows", (fieldAlerts ?? []).length === 0, `${fieldAlerts?.length ?? 0} rows`);

  const { data: fieldInvites } = await field.from("invites").select("id");
  check("field: invites return zero rows", (fieldInvites ?? []).length === 0, `${fieldInvites?.length ?? 0} rows`);
  const { data: fieldDigests } = await field.from("daily_digests").select("id");
  check("field: daily_digests return zero rows", (fieldDigests ?? []).length === 0, `${fieldDigests?.length ?? 0} rows`);
  const { data: fieldEdits } = await field.from("report_edits").select("id");
  check("field: report_edits return zero rows", (fieldEdits ?? []).length === 0, `${fieldEdits?.length ?? 0} rows`);

  const { data: fieldVehicles } = await field.from("vehicles").select("id");
  check("field: can read vehicles in their org", (fieldVehicles ?? []).length >= 1, `${fieldVehicles?.length ?? 0} rows`);

  const { data: fieldProfiles } = await field.from("profiles").select("id");
  check("field: sees only their own profile", (fieldProfiles ?? []).length === 1 && fieldProfiles?.[0]?.id === fieldProfile.id, `${fieldProfiles?.length ?? 0} rows`);

  const { data: fieldOrgs } = await field.from("organizations").select("id");
  check("field: sees their own org row", (fieldOrgs ?? []).length === 1, `${fieldOrgs?.length ?? 0} rows`);

  const { error: alertInsert } = await field
    .from("alerts")
    .insert({ org_id: orgId, type: "incident", severity: "low", message: "should be rejected" });
  check("field: cannot insert alerts", Boolean(alertInsert), alertInsert?.code ?? "inserted!");

  const { error: foreignInsert } = await field.from("reports").insert({
    client_uuid: randomUUID(),
    org_id: orgId,
    user_id: adminProfile.id,
    vehicle_id: vehicleId,
    report_date: new Date().toISOString().slice(0, 10),
    source: "text",
  });
  check("field: cannot insert a report for someone else", Boolean(foreignInsert), foreignInsert?.code ?? "inserted!");

  const ownUuid = randomUUID();
  const { data: ownReport, error: ownInsert } = await field
    .from("reports")
    .insert({
      client_uuid: ownUuid,
      org_id: orgId,
      user_id: fieldProfile.id,
      vehicle_id: vehicleId,
      report_date: new Date().toISOString().slice(0, 10),
      source: "text",
      typed_note: "RLS proof: own report",
    })
    .select("id")
    .single();
  check("field: can insert their own report", !ownInsert && Boolean(ownReport), ownInsert?.message ?? "ok");
  if (ownReport) cleanupIds.reports.push(ownReport.id);

  const { error: updateOwn } = await field.from("reports").update({ typed_note: "edited" }).eq("id", ownReport?.id ?? "");
  const { data: afterUpdate } = await admin.from("reports").select("typed_note").eq("id", ownReport?.id ?? "").maybeSingle();
  check("field: cannot update their own report (no update policy)", !updateOwn && afterUpdate?.typed_note !== "edited", afterUpdate?.typed_note ?? "");

  // --- staff --------------------------------------------------------------------------------
  const { data: staffReports } = await staff.from("reports").select("id");
  check("staff: sees org-wide reports (incl. the field user's)", (staffReports ?? []).some((r) => r.id === seededReport.id) && (staffReports ?? []).some((r) => r.id === ownReport?.id), `${staffReports?.length ?? 0} rows`);

  const { data: staffAlerts } = await staff.from("alerts").select("id");
  check("staff: sees org alerts", (staffAlerts ?? []).some((a) => a.id === seededAlert.id), `${staffAlerts?.length ?? 0} rows`);

  const { data: staffProfiles } = await staff.from("profiles").select("id");
  check("staff: sees org profiles", (staffProfiles ?? []).length >= 2, `${staffProfiles?.length ?? 0} rows`);

  const { data: staffInvites } = await staff.from("invites").select("id");
  check("staff: can read invites", Array.isArray(staffInvites), `${staffInvites?.length ?? 0} rows`);
} finally {
  await admin.from("reports").delete().in("id", cleanupIds.reports); // alerts cascade
  if (createdVehicle) await admin.from("vehicles").delete().eq("id", vehicleId);
}

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}`);
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
