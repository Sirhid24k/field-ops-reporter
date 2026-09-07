import { REPORT_AUDIO_BUCKET } from "@/lib/report-audio";
import type { TablesUpdate } from "@/lib/supabase/types";
import { decideClarification } from "./clarify";
import { daysBetween, type PipelineDb, toJson } from "./db";
import { errorMessage, RetryableError, UnrecoverableError } from "./errors";
import { extractReport, promotedColumns, type Extraction, type ExtractionContext } from "./extract";
import { logPipeline, timer } from "./log";
import { moveReportStatus, type ReportStatus } from "./status";
import { mimeForPath, transcribe } from "./stt";
import { summarize } from "./summary";
import { validateReport, type AlertDraft, type ValidationInput } from "./validate";

/**
 * The processing state machine (spec §5):
 *
 *   queued → transcribing → extracting → validating → ready | needs_clarification
 *                                                    ↘ failed (unrecoverable error)
 *
 * Every transition is a compare-and-set (lib/pipeline/status.ts), and each step's output
 * is persisted before the next transition, so a crash leaves a report that the sweep can
 * re-queue and a re-run can pick up without repeating paid work (a transcript is reused).
 *
 * Failures: RetryableError → back to `queued`, nothing counted, the sweep re-runs it;
 * anything else → `failed` with the message in `error`.
 */

export type ProcessOutcome =
  | { outcome: "processed"; status: "ready" | "needs_clarification"; questions: string[]; alerts: number }
  | { outcome: "skipped"; reason: string }
  | { outcome: "deferred"; reason: string }
  | { outcome: "failed"; error: string };

const REPORT_SELECT =
  "*, vehicles(id, plate_number, label, current_odometer), organizations(id, name, timezone, fuel_baseline_km_per_l)";

async function loadReport(db: PipelineDb, reportId: string) {
  const { data, error } = await db.from("reports").select(REPORT_SELECT).eq("id", reportId).maybeSingle();
  if (error) throw new Error(`Could not load report ${reportId}: ${error.message}`);
  return data;
}

type LoadedReport = NonNullable<Awaited<ReturnType<typeof loadReport>>>;
type Vehicle = NonNullable<LoadedReport["vehicles"]>;
type Organization = NonNullable<LoadedReport["organizations"]>;

/** Thrown when a compare-and-set loses: another worker or the sweep owns the report now. */
class LostClaimError extends Error {
  constructor(step: ReportStatus) {
    super(`lost the claim at ${step}`);
    this.name = "LostClaimError";
  }
}

type Heard = {
  transcript: string;
  language: string | null;
  thread: Array<{ question: string; answer: string }>;
  /** Rounds the driver has already answered; the clarification loop allows one. */
  answeredRounds: number;
};

function now(): string {
  return new Date().toISOString();
}

async function persist(db: PipelineDb, reportId: string, patch: TablesUpdate<"reports">): Promise<void> {
  const { error } = await db.from("reports").update(patch).eq("id", reportId);
  if (error) throw new Error(`Could not save report ${reportId}: ${error.message}`);
}

async function downloadAudio(db: PipelineDb, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(REPORT_AUDIO_BUCKET).download(path);
  if (error || !data) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : NaN;
    const message = `Could not download ${path}: ${error?.message ?? "no data"}`;
    if (status === 400 || status === 404) throw new UnrecoverableError(message, { cause: error });
    throw new RetryableError(message, { cause: error });
  }
  return Buffer.from(await data.arrayBuffer());
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

/** STT for the report (skipped for text reports and reused on a re-run) and for any voice answers. */
async function transcribeStep(db: PipelineDb, report: LoadedReport): Promise<Heard> {
  const elapsed = timer();
  let transcript: string;
  let language: string | null;
  let reused = false;

  if (report.source === "text") {
    transcript = (report.typed_note ?? "").trim();
    language = null;
    await persist(db, report.id, { transcript, transcript_language: null });
  } else if (report.transcript !== null) {
    transcript = report.transcript;
    language = report.transcript_language;
    reused = true;
  } else {
    const path = report.audio_path as string; // checked before the claim
    const heard = await transcribe(await downloadAudio(db, path), mimeForPath(path));
    transcript = heard.text;
    language = heard.language;
    await persist(db, report.id, { transcript, transcript_language: language });
  }

  if (!transcript && !report.typed_note?.trim()) {
    throw new UnrecoverableError(
      report.source === "voice"
        ? "Nothing could be heard in the recording. The driver should record it again."
        : "The report was empty.",
    );
  }

  const { data: rows, error } = await db
    .from("clarifications")
    .select("id, question, answer_text, answer_audio_path, answer_transcript, answered_at")
    .eq("report_id", report.id)
    .order("created_at");
  if (error) throw new Error(`Could not load clarifications for ${report.id}: ${error.message}`);

  const thread: Heard["thread"] = [];
  for (const row of rows ?? []) {
    if (!row.answered_at) continue;
    let answerTranscript = row.answer_transcript;
    if (row.answer_audio_path && answerTranscript === null) {
      const heard = await transcribe(await downloadAudio(db, row.answer_audio_path), mimeForPath(row.answer_audio_path));
      answerTranscript = heard.text;
      const { error: saveError } = await db.from("clarifications").update({ answer_transcript: answerTranscript }).eq("id", row.id);
      if (saveError) throw new Error(`Could not save the answer transcript for ${row.id}: ${saveError.message}`);
    }
    const answer = [row.answer_text?.trim(), answerTranscript?.trim()].filter(Boolean).join(" ");
    thread.push({ question: row.question, answer: answer || "(no answer could be heard)" });
  }
  const answeredRounds = new Set((rows ?? []).map((row) => row.answered_at).filter(Boolean)).size;

  logPipeline({
    step: "transcribe",
    reportId: report.id,
    outcome: "ok",
    ms: elapsed(),
    source: report.source,
    reused,
    language,
    chars: transcript.length,
    answers: thread.length,
  });
  return { transcript, language, thread, answeredRounds };
}

/** Gemini structured extraction; writes `extracted`, `confidence`, the promoted columns and the summary. */
async function extractStep(db: PipelineDb, report: LoadedReport, vehicle: Vehicle, org: Organization, heard: Heard): Promise<Extraction> {
  const elapsed = timer();
  const context: ExtractionContext = {
    transcript: heard.transcript,
    transcriptLanguage: heard.language,
    typedNote: report.source === "voice" ? report.typed_note : null,
    reportDate: report.report_date,
    plate: vehicle.plate_number,
    vehicleLabel: vehicle.label,
    lastOdometer: vehicle.current_odometer,
    fuelBaselineKmPerL: org.fuel_baseline_km_per_l,
    thread: heard.thread,
  };
  const extraction = await extractReport(context);
  const promoted = promotedColumns(extraction);

  // A driver usually gives one reading. The vehicle's last approved reading is, by
  // definition, where this trip started, so the promoted start takes it (and with it the
  // generated distance_km, the km on Today, and the digest totals). `extracted` keeps the
  // model's null: the raw record stays what the driver said. Code decision, not the model's.
  if (
    promoted.odometer_start === null &&
    promoted.odometer_end !== null &&
    vehicle.current_odometer !== null &&
    vehicle.current_odometer <= promoted.odometer_end
  ) {
    promoted.odometer_start = vehicle.current_odometer;
  }

  await persist(db, report.id, {
    ...promoted,
    extracted: toJson(extraction),
    confidence: toJson(extraction.confidence),
    summary: summarize({
      tripStatus: extraction.trip_status,
      origin: extraction.origin,
      destination: extraction.destination,
      odometerStart: promoted.odometer_start,
      odometerEnd: extraction.odometer_end,
      fuelLiters: extraction.fuel_liters,
      fuelCostNgn: extraction.fuel_cost_ngn,
      loadType: extraction.load_type,
      loadTonnage: extraction.load_tonnage,
      incidents: extraction.incidents,
    }),
  });

  logPipeline({
    step: "extract",
    reportId: report.id,
    outcome: "ok",
    ms: elapsed(),
    tripStatus: extraction.trip_status,
    missing: extraction.missing_fields,
    incidents: extraction.incidents.length,
  });
  return extraction;
}

/** Replaces the report's open alerts with the current set; acknowledged ones are kept and not re-raised. */
async function replaceAlerts(db: PipelineDb, report: LoadedReport, drafts: AlertDraft[]): Promise<number> {
  const { data: existing, error } = await db.from("alerts").select("id, type, status").eq("report_id", report.id);
  if (error) throw new Error(`Could not read alerts for ${report.id}: ${error.message}`);
  const acknowledged = new Set((existing ?? []).filter((alert) => alert.status === "acknowledged").map((alert) => alert.type));

  const { error: deleteError } = await db.from("alerts").delete().eq("report_id", report.id).eq("status", "open");
  if (deleteError) throw new Error(`Could not clear alerts for ${report.id}: ${deleteError.message}`);

  const rows = drafts
    .filter((draft) => !acknowledged.has(draft.type))
    .map((draft) => ({
      org_id: report.org_id,
      report_id: report.id,
      vehicle_id: report.vehicle_id,
      type: draft.type,
      severity: draft.severity,
      message: draft.message,
    }));
  if (rows.length > 0) {
    const { error: insertError } = await db.from("alerts").insert(rows);
    if (insertError) throw new Error(`Could not write alerts for ${report.id}: ${insertError.message}`);
  }
  return rows.length;
}

/** Deterministic checks, alerts, then the clarification decision and the final status. */
async function validateStep(
  db: PipelineDb,
  report: LoadedReport,
  vehicle: Vehicle,
  org: Organization,
  extraction: Extraction,
  answeredRounds: number,
): Promise<Extract<ProcessOutcome, { outcome: "processed" }>> {
  const elapsed = timer();

  const [duplicates, lastReviewed] = await Promise.all([
    db
      .from("reports")
      .select("id")
      .eq("vehicle_id", report.vehicle_id)
      .eq("report_date", report.report_date)
      .neq("id", report.id)
      .in("status", ["ready", "reviewed"]),
    db
      .from("reports")
      .select("report_date")
      .eq("vehicle_id", report.vehicle_id)
      .eq("status", "reviewed")
      .neq("id", report.id)
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (duplicates.error) throw new Error(`Could not check duplicates for ${report.id}: ${duplicates.error.message}`);
  if (lastReviewed.error) throw new Error(`Could not read vehicle history for ${report.id}: ${lastReviewed.error.message}`);

  const input: ValidationInput = {
    odometerStart: extraction.odometer_start,
    odometerEnd: extraction.odometer_end,
    fuelLiters: extraction.fuel_liters,
    fuelCostNgn: extraction.fuel_cost_ngn,
    loadTonnage: extraction.load_tonnage,
    incidents: extraction.incidents,
    lastOdometer: vehicle.current_odometer,
    daysSinceLastOdometer: daysBetween(lastReviewed.data?.report_date ?? null, report.report_date),
    fuelBaselineKmPerL: org.fuel_baseline_km_per_l,
    hasDuplicate: (duplicates.data?.length ?? 0) > 0,
  };
  const verdict = validateReport(input);
  await persist(db, report.id, { validation: toJson(verdict.results) });
  const alerts = await replaceAlerts(db, report, verdict.alerts);

  const decision = decideClarification(extraction, answeredRounds);
  const failedRules = verdict.results.filter((result) => !result.passed).map((result) => result.rule);

  if (decision.ask) {
    const { error } = await db
      .from("clarifications")
      .insert(decision.questions.map((question) => ({ report_id: report.id, org_id: report.org_id, question })));
    if (error) throw new Error(`Could not save the clarification for ${report.id}: ${error.message}`);
    if (!(await moveReportStatus(db, report.id, "validating", "needs_clarification", { processed_at: now(), error: null }))) {
      throw new LostClaimError("validating");
    }
    logPipeline({ step: "validate", reportId: report.id, outcome: "needs_clarification", ms: elapsed(), failedRules, alerts, missing: decision.missing });
    return { outcome: "processed", status: "needs_clarification", questions: decision.questions, alerts };
  }

  if (!(await moveReportStatus(db, report.id, "validating", "ready", { processed_at: now(), error: null }))) {
    throw new LostClaimError("validating");
  }
  logPipeline({ step: "validate", reportId: report.id, outcome: "ready", ms: elapsed(), failedRules, alerts, missing: decision.missing, answeredRounds });
  return { outcome: "processed", status: "ready", questions: [], alerts };
}

async function advance(db: PipelineDb, reportId: string, from: ReportStatus, to: ReportStatus): Promise<ReportStatus> {
  if (!(await moveReportStatus(db, reportId, from, to))) throw new LostClaimError(from);
  return to;
}

async function settle(db: PipelineDb, reportId: string, step: ReportStatus, error: unknown, ms: number): Promise<ProcessOutcome> {
  if (error instanceof LostClaimError) {
    logPipeline({ step: "process", reportId, outcome: "skipped", reason: error.message, ms });
    return { outcome: "skipped", reason: error.message };
  }
  if (error instanceof RetryableError) {
    await moveReportStatus(db, reportId, step, "queued", { error: error.message, processed_at: null });
    logPipeline({ step: "process", reportId, outcome: "deferred", at: step, reason: error.message, ms });
    return { outcome: "deferred", reason: error.message };
  }
  const message = (error instanceof UnrecoverableError ? error.message : `Processing failed at ${step}: ${errorMessage(error)}`).slice(0, 1_000);
  await moveReportStatus(db, reportId, step, "failed", { error: message, processed_at: now() });
  logPipeline({ step: "process", reportId, outcome: "failed", at: step, error: message, ms });
  return { outcome: "failed", error: message };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export async function processReport(db: PipelineDb, reportId: string): Promise<ProcessOutcome> {
  const elapsed = timer();
  const skip = (reason: string): ProcessOutcome => {
    logPipeline({ step: "process", reportId, outcome: "skipped", reason, ms: elapsed() });
    return { outcome: "skipped", reason };
  };

  const report = await loadReport(db, reportId);
  if (!report) return skip("report not found");
  if (report.status !== "queued") return skip(`status is ${report.status}`);
  if (report.source === "voice" && !report.audio_path) return skip("audio not uploaded yet");

  const vehicle = report.vehicles;
  const org = report.organizations;
  if (!vehicle || !org) {
    const message = "The report's vehicle or organisation no longer exists.";
    await moveReportStatus(db, reportId, "queued", "failed", { error: message, processed_at: now() });
    logPipeline({ step: "process", reportId, outcome: "failed", error: message, ms: elapsed() });
    return { outcome: "failed", error: message };
  }

  if (!(await moveReportStatus(db, reportId, "queued", "transcribing", { error: null, processed_at: null }))) {
    return skip("claimed by another worker");
  }
  logPipeline({ step: "claim", reportId, outcome: "ok", source: report.source, requeueCount: report.requeue_count });

  let step: ReportStatus = "transcribing";
  try {
    const heard = await transcribeStep(db, report);
    step = await advance(db, reportId, "transcribing", "extracting");
    const extraction = await extractStep(db, report, vehicle, org, heard);
    step = await advance(db, reportId, "extracting", "validating");
    const result = await validateStep(db, report, vehicle, org, extraction, heard.answeredRounds);
    logPipeline({ step: "process", reportId, outcome: result.status, ms: elapsed() });
    return result;
  } catch (error) {
    return settle(db, reportId, step, error, elapsed());
  }
}
