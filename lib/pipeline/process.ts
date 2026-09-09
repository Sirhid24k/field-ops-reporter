import { REPORT_AUDIO_BUCKET } from "@/lib/report-audio";
import { EMPTY_RECORDING_ERROR, EMPTY_REPORT_ERROR } from "@/lib/report-status";
import type { TablesUpdate } from "@/lib/supabase/types";
import { decideClarification } from "./clarify";
import { daysBetween, type PipelineDb, toJson } from "./db";
import { errorMessage, RetryableError, UnrecoverableError } from "./errors";
import { extractReport, promotedColumns, type Extraction, type ExtractionContext } from "./extract";
import { logPipeline, timer } from "./log";
import { moveReportStatus, type ReportStatus } from "./status";
import { mimeForPath, transcribe } from "./stt";
import { summarize } from "./summary";
import { MAX_REQUEUES } from "./sweep";
import { deriveFuelCost, validateReport, type AlertDraft, type ValidationInput } from "./validate";

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
 * Failures never leave a report in a moving status. A step that still fails after its
 * in-run retries (lib/pipeline/retry.ts), or that runs out of the invocation's time budget
 * (`deadlineAt`), puts the report back to `queued` with `requeue_count + 1` and a fresh
 * `status_changed_at`; the caller fires one more /api/process for it. After MAX_REQUEUES
 * such requeues the next failure marks it `failed`. An UnrecoverableError (silent audio, a
 * schema the model could not satisfy twice, bad configuration) is `failed` at once.
 */

export type ProcessOutcome =
  | { outcome: "processed"; status: "ready" | "needs_clarification"; questions: string[]; alerts: number }
  | { outcome: "skipped"; reason: string }
  | { outcome: "requeued"; reason: string; requeueCount: number }
  | { outcome: "failed"; error: string };

export type ProcessOptions = {
  /** Epoch milliseconds after which nothing may still be running: the function's time budget. */
  deadlineAt?: number | null;
};

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
export class LostClaimError extends Error {
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

type Run = { reportId: string; deadlineAt: number | null; steps: Record<string, number> };

function now(): string {
  return new Date().toISOString();
}

async function persist(db: PipelineDb, reportId: string, patch: TablesUpdate<"reports">): Promise<void> {
  const { error } = await db.from("reports").update(patch).eq("id", reportId);
  if (error) throw new Error(`Could not save report ${reportId}: ${error.message}`);
}

async function downloadAudio(db: PipelineDb, run: Run, path: string): Promise<Buffer> {
  const elapsed = timer();
  const { data, error } = await db.storage.from(REPORT_AUDIO_BUCKET).download(path);
  if (error || !data) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : NaN;
    const message = `Could not download ${path}: ${error?.message ?? "no data"}`;
    if (status === 400 || status === 404) throw new UnrecoverableError(message, { cause: error });
    throw new RetryableError(message, { cause: error });
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const ms = elapsed();
  run.steps.download = (run.steps.download ?? 0) + ms;
  logPipeline({ step: "download", reportId: run.reportId, outcome: "ok", ms, bytes: bytes.length });
  return bytes;
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------

/** STT for the report (skipped for text reports and reused on a re-run) and for any voice answers. */
async function transcribeStep(db: PipelineDb, run: Run, report: LoadedReport): Promise<Heard> {
  const elapsed = timer();
  const sttOptions = { deadlineAt: run.deadlineAt, reportId: report.id };
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
    const heard = await transcribe(await downloadAudio(db, run, path), mimeForPath(path), sttOptions);
    transcript = heard.text;
    language = heard.language;
    await persist(db, report.id, { transcript, transcript_language: language });
  }

  if (!transcript && !report.typed_note?.trim()) {
    throw new UnrecoverableError(report.source === "voice" ? EMPTY_RECORDING_ERROR : EMPTY_REPORT_ERROR);
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
      const heard = await transcribe(await downloadAudio(db, run, row.answer_audio_path), mimeForPath(row.answer_audio_path), sttOptions);
      answerTranscript = heard.text;
      const { error: saveError } = await db.from("clarifications").update({ answer_transcript: answerTranscript }).eq("id", row.id);
      if (saveError) throw new Error(`Could not save the answer transcript for ${row.id}: ${saveError.message}`);
    }
    const answer = [row.answer_text?.trim(), answerTranscript?.trim()].filter(Boolean).join(" ");
    thread.push({ question: row.question, answer: answer || "(no answer could be heard)" });
  }
  const answeredRounds = new Set((rows ?? []).map((row) => row.answered_at).filter(Boolean)).size;

  run.steps.transcribe = elapsed();
  logPipeline({
    step: "transcribe",
    reportId: report.id,
    outcome: "ok",
    ms: run.steps.transcribe,
    source: report.source,
    reused,
    language,
    chars: transcript.length,
    answers: thread.length,
  });
  return { transcript, language, thread, answeredRounds };
}

/** Gemini structured extraction; writes `extracted`, `confidence`, the promoted columns and the summary. */
async function extractStep(db: PipelineDb, run: Run, report: LoadedReport, vehicle: Vehicle, org: Organization, heard: Heard): Promise<Extraction> {
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
  const extraction = await extractReport(context, { deadlineAt: run.deadlineAt, reportId: report.id });
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
      fuelCostNgn: promoted.fuel_cost_ngn,
      loadType: extraction.load_type,
      loadTonnage: extraction.load_tonnage,
      incidents: extraction.incidents,
    }),
  });

  run.steps.extract = elapsed();
  logPipeline({
    step: "extract",
    reportId: report.id,
    outcome: "ok",
    ms: run.steps.extract,
    tripStatus: extraction.trip_status,
    missing: extraction.missing_fields,
    incidents: extraction.incidents.length,
    fuelCostDerived: extraction.fuel_cost_ngn === null && promoted.fuel_cost_ngn !== null,
  });
  return extraction;
}

/**
 * Replaces the report's open alerts with the current set; acknowledged ones are kept and not
 * re-raised. Also used by lib/pipeline/recheck.ts after a supervisor edits a field.
 */
export async function replaceAlerts(
  db: PipelineDb,
  report: Pick<LoadedReport, "id" | "org_id" | "vehicle_id">,
  drafts: AlertDraft[],
): Promise<number> {
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
  run: Run,
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
    fuelCostNgn: deriveFuelCost({
      fuelLiters: extraction.fuel_liters,
      fuelCostNgn: extraction.fuel_cost_ngn,
      fuelPricePerLNgn: extraction.fuel_price_per_l_ngn,
    }),
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
    run.steps.validate = elapsed();
    logPipeline({ step: "validate", reportId: report.id, outcome: "needs_clarification", ms: run.steps.validate, failedRules, alerts, missing: decision.missing });
    return { outcome: "processed", status: "needs_clarification", questions: decision.questions, alerts };
  }

  if (!(await moveReportStatus(db, report.id, "validating", "ready", { processed_at: now(), error: null }))) {
    throw new LostClaimError("validating");
  }
  run.steps.validate = elapsed();
  logPipeline({ step: "validate", reportId: report.id, outcome: "ready", ms: run.steps.validate, failedRules, alerts, missing: decision.missing, answeredRounds });
  return { outcome: "processed", status: "ready", questions: [], alerts };
}

async function advance(db: PipelineDb, reportId: string, from: ReportStatus, to: ReportStatus): Promise<ReportStatus> {
  if (!(await moveReportStatus(db, reportId, from, to))) throw new LostClaimError(from);
  return to;
}

// ---------------------------------------------------------------------------
// settlement: what happens to a report whose run threw
// ---------------------------------------------------------------------------

export type Settlement =
  | { action: "skip"; reason: string }
  | { action: "requeue"; requeueCount: number; reason: string }
  | { action: "fail"; message: string };

/**
 * Pure. A lost claim is somebody else's report now. An UnrecoverableError fails at once. A
 * RetryableError (retries exhausted, or the run's deadline reached) and anything unexpected
 * (a database hiccup, a bug) go back to `queued` with `requeue_count + 1`, unless the report
 * has already been requeued MAX_REQUEUES times, in which case it fails with the reason.
 */
export function decideSettlement(error: unknown, step: ReportStatus, requeueCount: number): Settlement {
  if (error instanceof LostClaimError) return { action: "skip", reason: error.message };
  if (error instanceof UnrecoverableError) return { action: "fail", message: error.message.slice(0, 1_000) };

  const reason = (error instanceof RetryableError ? error.message : `Processing failed at ${step}: ${errorMessage(error)}`).slice(0, 1_000);
  if (requeueCount >= MAX_REQUEUES) {
    return { action: "fail", message: `Processing did not finish after ${MAX_REQUEUES} retries (stuck at ${step}): ${reason}`.slice(0, 1_000) };
  }
  return { action: "requeue", requeueCount: requeueCount + 1, reason };
}

async function settle(db: PipelineDb, run: Run, report: LoadedReport, step: ReportStatus, error: unknown, ms: number): Promise<ProcessOutcome> {
  const settlement = decideSettlement(error, step, report.requeue_count);
  const budgetLeftMs = run.deadlineAt === null ? null : run.deadlineAt - Date.now();

  if (settlement.action === "skip") {
    logPipeline({ step: "process", reportId: report.id, outcome: "skipped", reason: settlement.reason, ms, steps: run.steps });
    return { outcome: "skipped", reason: settlement.reason };
  }

  if (settlement.action === "requeue") {
    const moved = await moveReportStatus(db, report.id, step, "queued", {
      requeue_count: settlement.requeueCount,
      status_changed_at: now(),
      error: settlement.reason,
      processed_at: null,
    });
    logPipeline({
      step: "process",
      reportId: report.id,
      outcome: moved ? "requeued" : "requeue_lost",
      at: step,
      requeueCount: settlement.requeueCount,
      reason: settlement.reason,
      ms,
      steps: run.steps,
      budgetLeftMs,
    });
    return { outcome: "requeued", reason: settlement.reason, requeueCount: settlement.requeueCount };
  }

  await moveReportStatus(db, report.id, step, "failed", { error: settlement.message, processed_at: now() });
  logPipeline({ step: "process", reportId: report.id, outcome: "failed", at: step, error: settlement.message, ms, steps: run.steps, budgetLeftMs });
  return { outcome: "failed", error: settlement.message };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export async function processReport(db: PipelineDb, reportId: string, options: ProcessOptions = {}): Promise<ProcessOutcome> {
  const elapsed = timer();
  const run: Run = { reportId, deadlineAt: options.deadlineAt ?? null, steps: {} };
  const skip = (reason: string): ProcessOutcome => {
    logPipeline({ step: "process", reportId, outcome: "skipped", reason, ms: elapsed() });
    return { outcome: "skipped", reason };
  };

  const report = await loadReport(db, reportId);
  run.steps.load = elapsed();
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
  logPipeline({
    step: "claim",
    reportId,
    outcome: "ok",
    source: report.source,
    requeueCount: report.requeue_count,
    budgetMs: run.deadlineAt === null ? null : run.deadlineAt - Date.now(),
  });

  let step: ReportStatus = "transcribing";
  try {
    const heard = await transcribeStep(db, run, report);
    step = await advance(db, reportId, "transcribing", "extracting");
    const extraction = await extractStep(db, run, report, vehicle, org, heard);
    step = await advance(db, reportId, "extracting", "validating");
    const result = await validateStep(db, run, report, vehicle, org, extraction, heard.answeredRounds);
    logPipeline({
      step: "process",
      reportId,
      outcome: result.status,
      ms: elapsed(),
      steps: run.steps,
      budgetLeftMs: run.deadlineAt === null ? null : run.deadlineAt - Date.now(),
    });
    return result;
  } catch (error) {
    return settle(db, run, report, step, error, elapsed());
  }
}
