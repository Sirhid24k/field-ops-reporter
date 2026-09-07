import { formatDayLong, formatDayShort } from "@/lib/dates";
import { formatGrouped } from "@/lib/format";
import type { Tables } from "@/lib/supabase/types";
import { type PipelineDb, toJson } from "./db";
import { errorMessage, RetryableError } from "./errors";
import { generateText, modelFor } from "./gemini";
import { logPipeline, timer } from "./log";
import { missingReportAlert, SEVERITY_RANK, type Severity } from "./validate";

/**
 * Daily digest (spec M13). `stats` and every line of the summary come from the structured
 * rows; DIGEST_MODEL only turns that JSON into readable markdown. Transcripts never reach
 * the model here. If the model is unavailable for a reason other than a rate limit, a
 * deterministic renderer writes the same sections so the digest always exists.
 */

export type DigestOrg = Pick<Tables<"organizations">, "id" | "name" | "timezone" | "report_cutoff_time">;

/** The exact shape stored in daily_digests.stats (spec §7). */
export type DigestStats = { reported: number; missing: number; alerts: number; total_km: number; total_fuel_l: number };

export type DigestTrip = {
  vehicle: string;
  driver: string | null;
  route: string | null;
  trip_status: string | null;
  distance_km: number | null;
  fuel_liters: number | null;
  fuel_cost_ngn: number | null;
  load: string | null;
  incidents: string[];
  report_status: string;
};

export type DigestAttention = { vehicle: string; driver: string | null; severity: Severity; issues: string[] };

export type DigestData = {
  org: string;
  date: string;
  date_label: string;
  vehicles_total: number;
  stats: DigestStats;
  needs_attention: DigestAttention[];
  did_not_report: Array<{ vehicle: string; driver: string | null }>;
  trips: DigestTrip[];
};

/** Statuses that count as "reported" on the board; only ready/reviewed feed the totals. */
const REPORTED_STATUSES = ["ready", "reviewed", "needs_clarification"] as const;
const COUNTED_STATUSES = new Set<string>(["ready", "reviewed"]);

// ---------------------------------------------------------------------------
// time in the organisation's zone
// ---------------------------------------------------------------------------

function zoneFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function partsOf(formatter: Intl.DateTimeFormat, date: Date) {
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** The organisation's local calendar date and minutes since local midnight. */
export function localClock(timeZone: string, now: Date): { date: string; minutes: number } {
  try {
    const local = partsOf(zoneFormatter(timeZone), now);
    const pad = (value: number) => String(value).padStart(2, "0");
    return { date: `${local.year}-${pad(local.month)}-${pad(local.day)}`, minutes: local.hour * 60 + local.minute };
  } catch {
    return { date: now.toISOString().slice(0, 10), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

/** "20:00:00" → 1200 */
export function cutoffMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number.parseInt(part, 10));
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

/** YYYY-MM-DD minus one day. */
function previousDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * The reporting day a cron run should close: today once the organisation's cutoff has
 * passed, otherwise yesterday. Written for a cron that fires once a day at an imprecise hour
 * (Vercel Hobby: daily, anywhere within the scheduled hour), so a run that lands before an
 * organisation's cutoff still closes its previous day instead of skipping it.
 */
export function digestDateFor(clock: { date: string; minutes: number }, cutoff: number): { date: string; target: "today" | "yesterday" } {
  return clock.minutes >= cutoff ? { date: clock.date, target: "today" } : { date: previousDate(clock.date), target: "yesterday" };
}

/** The UTC instants [start, end) of one local calendar day. */
export function utcRangeForLocalDay(date: string, timeZone: string): { start: string; end: string } {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  let offset = 0;
  try {
    const local = partsOf(zoneFormatter(timeZone), new Date(guess));
    offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - guess;
  } catch {
    offset = 0;
  }
  const start = guess - offset;
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() };
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function incidentLines(extracted: unknown): string[] {
  if (!extracted || typeof extracted !== "object") return [];
  const list = (extracted as { incidents?: unknown }).incidents;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { type, description } = entry as { type?: unknown; description?: unknown };
    const label = typeof type === "string" ? type : "incident";
    return [typeof description === "string" && description ? `${label}: ${description}` : label];
  });
}

/** Everything the digest needs for one org and one local date, aggregated in code from the rows. */
export async function collectDigestData(db: PipelineDb, org: DigestOrg, date: string): Promise<DigestData> {
  const [vehiclesQuery, reportsQuery] = await Promise.all([
    db
      .from("vehicles")
      .select("id, plate_number, label, profiles!vehicles_default_driver_id_fkey(full_name)")
      .eq("org_id", org.id)
      .eq("active", true)
      .order("plate_number"),
    db
      .from("reports")
      .select(
        "id, vehicle_id, status, origin, destination, trip_status, distance_km, fuel_liters, fuel_cost_ngn, load_type, load_tonnage, extracted, submitted_at, profiles!reports_user_id_fkey(full_name), vehicles(plate_number)",
      )
      .eq("org_id", org.id)
      .eq("report_date", date)
      .in("status", [...REPORTED_STATUSES])
      .order("submitted_at"),
  ]);
  if (vehiclesQuery.error) throw new Error(`Digest could not read vehicles: ${vehiclesQuery.error.message}`);
  if (reportsQuery.error) throw new Error(`Digest could not read reports: ${reportsQuery.error.message}`);
  const vehicles = vehiclesQuery.data ?? [];
  const reports = reportsQuery.data ?? [];
  const reportIds = reports.map((report) => report.id);

  const range = utcRangeForLocalDay(date, org.timezone);
  const [alertsQuery, missingAlertsQuery, questionsQuery] = await Promise.all([
    reportIds.length > 0
      ? db.from("alerts").select("id, report_id, vehicle_id, type, severity, message, status").in("report_id", reportIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("alerts")
      .select("id, report_id, vehicle_id, type, severity, message, status")
      .eq("org_id", org.id)
      .eq("type", "missing_report")
      .gte("created_at", range.start)
      .lt("created_at", range.end),
    reportIds.length > 0
      ? db.from("clarifications").select("report_id, question").in("report_id", reportIds).is("answered_at", null).order("created_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (alertsQuery.error) throw new Error(`Digest could not read alerts: ${alertsQuery.error.message}`);
  if (missingAlertsQuery.error) throw new Error(`Digest could not read alerts: ${missingAlertsQuery.error.message}`);
  if (questionsQuery.error) throw new Error(`Digest could not read clarifications: ${questionsQuery.error.message}`);
  const reportAlerts = alertsQuery.data ?? [];
  const missingAlerts = missingAlertsQuery.data ?? [];
  const openQuestions = questionsQuery.data ?? [];

  const reportedVehicleIds = new Set(reports.map((report) => report.vehicle_id));
  const didNotReport = vehicles
    .filter((vehicle) => !reportedVehicleIds.has(vehicle.id))
    .map((vehicle) => ({ vehicle: vehicle.plate_number, driver: vehicle.profiles?.full_name ?? null }));

  const counted = reports.filter((report) => COUNTED_STATUSES.has(report.status));
  const stats: DigestStats = {
    reported: reportedVehicleIds.size,
    missing: didNotReport.length,
    alerts: reportAlerts.length + missingAlerts.length,
    total_km: round1(counted.reduce((sum, report) => sum + (report.distance_km ?? 0), 0)),
    total_fuel_l: round1(counted.reduce((sum, report) => sum + (report.fuel_liters ?? 0), 0)),
  };

  const attention = new Map<string, DigestAttention>();
  const noteFor = (report: (typeof reports)[number]) => {
    const key = report.id;
    let entry = attention.get(key);
    if (!entry) {
      entry = { vehicle: report.vehicles?.plate_number ?? "Unknown vehicle", driver: report.profiles?.full_name ?? null, severity: "low", issues: [] };
      attention.set(key, entry);
    }
    return entry;
  };
  for (const alert of reportAlerts) {
    const report = reports.find((candidate) => candidate.id === alert.report_id);
    if (!report) continue;
    const entry = noteFor(report);
    entry.issues.push(alert.status === "acknowledged" ? `${alert.message} (acknowledged)` : alert.message);
    if (SEVERITY_RANK[alert.severity] > SEVERITY_RANK[entry.severity]) entry.severity = alert.severity;
  }
  for (const question of openQuestions) {
    const report = reports.find((candidate) => candidate.id === question.report_id);
    if (!report) continue;
    noteFor(report).issues.push(`Waiting for the driver's answer: ${question.question}`);
  }
  const needsAttention = Array.from(attention.values()).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const trips: DigestTrip[] = reports.map((report) => ({
    vehicle: report.vehicles?.plate_number ?? "Unknown vehicle",
    driver: report.profiles?.full_name ?? null,
    route: report.origin && report.destination ? `${report.origin} → ${report.destination}` : null,
    trip_status: report.trip_status,
    distance_km: report.distance_km,
    fuel_liters: report.fuel_liters,
    fuel_cost_ngn: report.fuel_cost_ngn,
    load:
      report.load_type || report.load_tonnage !== null
        ? [report.load_type, report.load_tonnage !== null ? `${formatGrouped(report.load_tonnage, { maximumFractionDigits: 1 })} t` : null].filter(Boolean).join(", ")
        : null,
    incidents: incidentLines(report.extracted),
    report_status: report.status,
  }));

  return {
    org: org.name,
    date,
    date_label: formatDayLong(date),
    vehicles_total: vehicles.length,
    stats,
    needs_attention: needsAttention,
    did_not_report: didNotReport,
    trips,
  };
}

/** One `missing_report` alert per vehicle without a report, once per local day. Returns how many were added. */
export async function ensureMissingReportAlerts(db: PipelineDb, org: DigestOrg, date: string, data: DigestData): Promise<number> {
  if (data.did_not_report.length === 0) return 0;
  const range = utcRangeForLocalDay(date, org.timezone);
  const [{ data: vehicles, error: vehiclesError }, { data: existing, error: existingError }] = await Promise.all([
    db.from("vehicles").select("id, plate_number").eq("org_id", org.id).eq("active", true),
    db.from("alerts").select("vehicle_id").eq("org_id", org.id).eq("type", "missing_report").gte("created_at", range.start).lt("created_at", range.end),
  ]);
  if (vehiclesError) throw new Error(`Could not read vehicles: ${vehiclesError.message}`);
  if (existingError) throw new Error(`Could not read alerts: ${existingError.message}`);

  const alreadyFlagged = new Set((existing ?? []).map((alert) => alert.vehicle_id));
  const plates = new Set(data.did_not_report.map((entry) => entry.vehicle));
  const rows = (vehicles ?? [])
    .filter((vehicle) => plates.has(vehicle.plate_number) && !alreadyFlagged.has(vehicle.id))
    .map((vehicle) => ({ org_id: org.id, vehicle_id: vehicle.id, report_id: null, ...missingReportAlert(vehicle.plate_number, formatDayShort(date)) }));
  if (rows.length === 0) return 0;
  const { error } = await db.from("alerts").insert(rows);
  if (error) throw new Error(`Could not write missing-report alerts: ${error.message}`);
  logPipeline({ step: "digest.missing_alerts", org: org.id, date, outcome: "ok", inserted: rows.length });
  return rows.length;
}

// ---------------------------------------------------------------------------
// markdown
// ---------------------------------------------------------------------------

const DIGEST_SYSTEM_PROMPT = [
  "You write the end-of-day digest for the manager of a small Nigerian haulage or site-work firm.",
  "You receive one JSON object describing the day. Use only what is in it: never add, estimate or round a number, and never guess a name or a place.",
  "",
  "Write Markdown with exactly these sections, in this order:",
  "1. A level-1 heading with the date_label.",
  '2. "## Needs your attention": one bullet per entry in needs_attention, as "plate, driver: the issue sentences". If there are none, the single line "Nothing needs your attention."',
  '3. "## Did not report": one bullet per entry in did_not_report, as "plate, driver" (just the plate when the driver is null). If there are none, the single line "Every vehicle reported."',
  '4. "## The day\'s numbers": a line "Reported X of Y vehicles, N alerts." (from stats and vehicles_total), a line with total_km km driven and total_fuel_l L of fuel, then one bullet per trip as "plate, driver: route, km, litres, fuel cost in naira, load", leaving out any value that is null.',
  "",
  "Plain words, sentence case, no emoji, no preamble, no closing remarks, no advice. Keep every line under 70 characters; wrap a long bullet onto a continuation line indented by two spaces.",
].join("\n");

function fmtNumber(value: number | null, digits = 0): string | null {
  return value === null ? null : formatGrouped(value, { maximumFractionDigits: digits });
}

/** Deterministic markdown with the same sections as the model's, for when the model is unavailable. */
export function renderDigestFallback(data: DigestData): string {
  const lines: string[] = [`# ${data.date_label}`, "", "## Needs your attention"];
  if (data.needs_attention.length === 0) lines.push("Nothing needs your attention.");
  for (const entry of data.needs_attention) {
    lines.push(`- ${entry.vehicle}${entry.driver ? `, ${entry.driver}` : ""}: ${entry.issues.join(" ")}`);
  }
  lines.push("", "## Did not report");
  if (data.did_not_report.length === 0) lines.push("Every vehicle reported.");
  for (const entry of data.did_not_report) lines.push(`- ${entry.vehicle}${entry.driver ? `, ${entry.driver}` : ""}`);
  lines.push("", "## The day's numbers");
  lines.push(`Reported ${data.stats.reported} of ${data.vehicles_total} vehicles, ${data.stats.alerts} alert${data.stats.alerts === 1 ? "" : "s"}.`);
  lines.push(`${formatGrouped(data.stats.total_km, { maximumFractionDigits: 1 })} km driven, ${formatGrouped(data.stats.total_fuel_l, { maximumFractionDigits: 1 })} L of fuel.`);
  for (const trip of data.trips) {
    const parts = [
      trip.route ?? trip.trip_status?.replace("_", " ") ?? null,
      trip.distance_km !== null ? `${fmtNumber(trip.distance_km)} km` : null,
      trip.fuel_liters !== null ? `${fmtNumber(trip.fuel_liters, 1)} L` : null,
      trip.fuel_cost_ngn !== null ? `₦${fmtNumber(trip.fuel_cost_ngn)}` : null,
      trip.load,
    ].filter(Boolean);
    lines.push(`- ${trip.vehicle}${trip.driver ? `, ${trip.driver}` : ""}: ${parts.join(", ")}`);
  }
  return lines.join("\n");
}

function looksLikeDigest(markdown: string): boolean {
  return markdown.includes("Needs your attention") && markdown.includes("Did not report") && markdown.length > 40;
}

/** DIGEST_MODEL writes the markdown from the structured JSON (no transcripts). */
export async function writeDigestMarkdown(data: DigestData): Promise<string> {
  const markdown = await generateText({
    model: modelFor("digest"),
    system: DIGEST_SYSTEM_PROMPT,
    prompt: JSON.stringify(data, null, 2),
    temperature: 0.3,
  });
  const cleaned = markdown.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!looksLikeDigest(cleaned)) throw new Error("The model's digest was missing the required sections.");
  return cleaned;
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

export type DigestResult = { data: DigestData; content_md: string; source: "model" | "fallback" };

/**
 * Builds the stats from the rows, optionally raises missing-report alerts (only past the
 * cutoff), writes the markdown and upserts daily_digests on (org_id, digest_date).
 * A rate limit propagates as RetryableError so the caller can try again later.
 */
export async function generateDigest(
  db: PipelineDb,
  org: DigestOrg,
  date: string,
  options: { withMissingAlerts: boolean },
): Promise<DigestResult> {
  const elapsed = timer();
  let data = await collectDigestData(db, org, date);
  if (options.withMissingAlerts && (await ensureMissingReportAlerts(db, org, date, data)) > 0) {
    data = await collectDigestData(db, org, date);
  }

  let content: string;
  let source: DigestResult["source"];
  try {
    content = await writeDigestMarkdown(data);
    source = "model";
  } catch (error) {
    if (error instanceof RetryableError) throw error;
    logPipeline({ step: "digest.model", org: org.id, date, outcome: "fallback", error: errorMessage(error) });
    content = renderDigestFallback(data);
    source = "fallback";
  }

  const { error } = await db
    .from("daily_digests")
    .upsert(
      { org_id: org.id, digest_date: date, content_md: content, stats: toJson(data.stats), generated_at: new Date().toISOString() },
      { onConflict: "org_id,digest_date" },
    );
  if (error) throw new Error(`Could not save the digest: ${error.message}`);

  logPipeline({ step: "digest", org: org.id, date, outcome: source, ms: elapsed(), stats: data.stats });
  return { data, content_md: content, source };
}

export type DigestCronOutcome = {
  orgId: string;
  date: string;
  target: "today" | "yesterday";
  outcome: "generated" | "exists" | "deferred" | "error";
  detail?: string;
};

/**
 * One pass for every organisation: pick the latest reporting day whose cutoff has passed
 * (today after the cutoff, else yesterday), skip it when its digest already exists, otherwise
 * raise the missing-report alerts and write the digest (both inside `generateDigest`).
 * Idempotent, so it is safe to run once a day at any hour (Vercel Hobby) or more often; a
 * rate-limited model call leaves the org for the next run or an on-demand generation.
 */
export async function runDigestCron(db: PipelineDb, now: Date = new Date()): Promise<DigestCronOutcome[]> {
  const { data: orgs, error } = await db.from("organizations").select("id, name, timezone, report_cutoff_time");
  if (error) throw new Error(`Digest cron could not read organisations: ${error.message}`);

  const outcomes: DigestCronOutcome[] = [];
  for (const org of orgs ?? []) {
    const { date, target } = digestDateFor(localClock(org.timezone, now), cutoffMinutes(org.report_cutoff_time));
    const { data: existing, error: existingError } = await db
      .from("daily_digests")
      .select("id")
      .eq("org_id", org.id)
      .eq("digest_date", date)
      .maybeSingle();
    if (existingError) {
      outcomes.push({ orgId: org.id, date, target, outcome: "error", detail: existingError.message });
      continue;
    }
    if (existing) {
      outcomes.push({ orgId: org.id, date, target, outcome: "exists" });
      continue;
    }
    try {
      await generateDigest(db, org, date, { withMissingAlerts: true });
      outcomes.push({ orgId: org.id, date, target, outcome: "generated" });
    } catch (caught) {
      const retryable = caught instanceof RetryableError;
      outcomes.push({ orgId: org.id, date, target, outcome: retryable ? "deferred" : "error", detail: errorMessage(caught) });
      logPipeline({ step: "digest", org: org.id, date, outcome: retryable ? "deferred" : "error", error: errorMessage(caught) });
    }
  }
  return outcomes;
}
