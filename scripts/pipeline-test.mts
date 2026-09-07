// Runs the processing pipeline inline against the live project and prints what happened.
//
//   npm run pipeline:test -- <audio-file> [--note "typed note"] [--date YYYY-MM-DD] [--driver email]
//   npm run pipeline:test -- --text "typed report"            (text-only report)
//   npm run pipeline:test -- --report <id>                    (re-run an existing report)
//   npm run pipeline:test -- --report <id> --answer "184 510" (answer its open question, then re-run)
//   npm run pipeline:test -- --report <id> --answer-audio <file>
//   add --cleanup to delete the report (and its audio) afterwards
//
// Creates the report for the driver (default driver-demo@example.com) on the vehicle they
// drive, uploads the file to report-audio/{org}/{report}.{ext}, then calls processReport
// exactly as /api/process does. Uses the service role; local only.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env"; // CommonJS package: default import, then destructure
import { processReport } from "../lib/pipeline/process";
import { REPORT_AUDIO_BUCKET, clarificationAudioPath, reportAudioPath } from "../lib/report-audio";
import { mimeForPath } from "../lib/pipeline/stt";
import type { Database } from "../lib/supabase/types";

nextEnv.loadEnvConfig(process.cwd(), true);

// --- arguments ------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith("--")) {
    const name = arg.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      i += 1;
    } else {
      flags.set(name, true);
    }
  } else {
    positional.push(arg);
  }
}
const text = (name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
};

const audioFile = positional[0];
const typedText = text("text");
const existingReportId = text("report");
const answerText = text("answer");
const answerAudio = text("answer-audio");
const driverEmail = text("driver") ?? "driver-demo@example.com";

if (!audioFile && !typedText && !existingReportId) {
  console.error("usage: npm run pipeline:test -- <audio-file> [--note ...] | --text ... | --report <id> [--answer ... | --answer-audio <file>]");
  process.exit(2);
}

// --- client -----------------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}
const db = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function driverProfile(email: string) {
  const { data: users, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) fail(`listUsers: ${error.message}`);
  const user = users.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) fail(`No auth user for ${email}`);
  const { data: profile } = await db.from("profiles").select("id, org_id, full_name").eq("id", user.id).maybeSingle();
  if (!profile) fail(`No profile for ${email}`);
  return profile;
}

async function upload(storagePath: string, file: string): Promise<void> {
  const bytes = await readFile(file);
  const { error } = await db.storage.from(REPORT_AUDIO_BUCKET).upload(storagePath, bytes, { contentType: mimeForPath(file), upsert: true });
  if (error) fail(`upload ${storagePath}: ${error.message}`);
  console.log(`uploaded ${path.basename(file)} (${bytes.length} bytes) → ${storagePath}`);
}

// --- the report ---------------------------------------------------------------------------------

let reportId: string;
let orgId: string;

if (existingReportId) {
  const { data: report } = await db.from("reports").select("id, org_id, status").eq("id", existingReportId).maybeSingle();
  if (!report) fail(`No report ${existingReportId}`);
  reportId = report.id;
  orgId = report.org_id;
  console.log(`report ${reportId} (status ${report.status})`);

  if (answerText || answerAudio) {
    const { data: open } = await db.from("clarifications").select("id, question, answered_at").eq("report_id", reportId).order("created_at");
    const rows = open ?? [];
    const unanswered = rows.filter((row) => row.answered_at === null);
    if (unanswered.length === 0) fail("No open question to answer on this report.");
    const rounds = new Set(rows.map((row) => row.answered_at).filter(Boolean)).size;
    let audioPath: string | null = null;
    if (answerAudio) {
      audioPath = clarificationAudioPath(orgId, reportId, rounds + 1, mimeForPath(answerAudio));
      await upload(audioPath, answerAudio);
    }
    const answeredAt = new Date().toISOString();
    const { error } = await db
      .from("clarifications")
      .update({ answer_text: answerText ?? null, answer_audio_path: audioPath, answered_at: answeredAt })
      .eq("report_id", reportId)
      .is("answered_at", null);
    if (error) fail(`answer: ${error.message}`);
    for (const row of unanswered) console.log(`answered "${row.question}" → ${answerText ?? `voice (${audioPath})`}`);
  }

  const { error } = await db.from("reports").update({ status: "queued", requeue_count: 0, error: null, processed_at: null }).eq("id", reportId);
  if (error) fail(`requeue: ${error.message}`);
} else {
  const driver = await driverProfile(driverEmail);
  orgId = driver.org_id;
  const { data: organization } = await db.from("organizations").select("id, name, timezone").eq("id", orgId).single();
  const { data: vehicles } = await db.from("vehicles").select("id, plate_number, default_driver_id, current_odometer").eq("org_id", orgId).eq("active", true).order("created_at");
  const vehicle = (vehicles ?? []).find((candidate) => candidate.default_driver_id === driver.id) ?? vehicles?.[0];
  if (!vehicle || !organization) fail("The driver's organisation has no active vehicle.");

  const reportDate =
    text("date") ??
    new Intl.DateTimeFormat("en-CA", { timeZone: organization.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const mime = audioFile ? mimeForPath(audioFile) : null;
  const { data: inserted, error } = await db
    .from("reports")
    .insert({
      client_uuid: randomUUID(),
      org_id: orgId,
      user_id: driver.id,
      vehicle_id: vehicle.id,
      report_date: reportDate,
      status: "queued",
      source: audioFile ? "voice" : "text",
      typed_note: audioFile ? (text("note") ?? null) : typedText!,
    })
    .select("id")
    .single();
  if (error || !inserted) fail(`insert report: ${error?.message}`);
  reportId = inserted.id;
  console.log(`${organization.name}, ${driver.full_name}, ${vehicle.plate_number} (odometer ${vehicle.current_odometer ?? "unknown"}), ${reportDate}`);
  console.log(`report ${reportId} (${audioFile ? "voice" : "text"})`);

  if (audioFile) {
    const storagePath = reportAudioPath(orgId, reportId, mime);
    await upload(storagePath, audioFile);
    const { error: markError } = await db.from("reports").update({ audio_path: storagePath }).eq("id", reportId);
    if (markError) fail(`audio_path: ${markError.message}`);
  }
}

// --- run ------------------------------------------------------------------------------------------

console.log("\n--- processing ---");
const started = Date.now();
const outcome = await processReport(db, reportId);
console.log(`--- ${outcome.outcome} in ${((Date.now() - started) / 1000).toFixed(1)}s ---\n`);
console.log(JSON.stringify(outcome, null, 2));

const { data: report } = await db
  .from("reports")
  .select("status, error, transcript, transcript_language, summary, extracted, validation, origin, destination, odometer_start, odometer_end, distance_km, fuel_liters, fuel_cost_ngn, load_type, load_tonnage, trip_status")
  .eq("id", reportId)
  .single();
const { data: clarifications } = await db.from("clarifications").select("question, answer_text, answer_transcript, answered_at").eq("report_id", reportId).order("created_at");
const { data: alerts } = await db.from("alerts").select("type, severity, message, status").eq("report_id", reportId).order("created_at");

if (report) {
  console.log(`\nstatus: ${report.status}${report.error ? ` (error: ${report.error})` : ""}`);
  console.log(`\ntranscript (${report.transcript_language ?? "typed"}):\n${report.transcript ?? "(none)"}`);
  console.log(`\nsummary: ${report.summary ?? "(none)"}`);
  console.log(`\npromoted: ${JSON.stringify({
    trip_status: report.trip_status,
    origin: report.origin,
    destination: report.destination,
    odometer_start: report.odometer_start,
    odometer_end: report.odometer_end,
    distance_km: report.distance_km,
    fuel_liters: report.fuel_liters,
    fuel_cost_ngn: report.fuel_cost_ngn,
    load_type: report.load_type,
    load_tonnage: report.load_tonnage,
  })}`);
  console.log(`\nextracted:\n${JSON.stringify(report.extracted, null, 2)}`);
  console.log(`\nvalidation:\n${JSON.stringify(report.validation, null, 2)}`);
}
console.log(`\nclarifications:\n${JSON.stringify(clarifications ?? [], null, 2)}`);
console.log(`\nalerts:\n${JSON.stringify(alerts ?? [], null, 2)}`);

if (flags.get("cleanup")) {
  const { data: files } = await db.storage.from(REPORT_AUDIO_BUCKET).list(orgId, { search: reportId });
  if (files && files.length > 0) await db.storage.from(REPORT_AUDIO_BUCKET).remove(files.map((file) => `${orgId}/${file.name}`));
  await db.from("reports").delete().eq("id", reportId);
  console.log(`\ndeleted report ${reportId}`);
}
