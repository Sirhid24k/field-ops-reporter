"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import {
  asObject,
  EDITABLE_FIELDS,
  EDITABLE_STATUSES,
  type EditableField,
  type FieldValue,
  incidentsFrom,
  parseFieldInput,
  sameValue,
} from "@/lib/admin/report-fields";
import { requireStaff } from "@/lib/auth";
import { errorMessage } from "@/lib/pipeline/errors";
import { triggerProcessing } from "@/lib/pipeline/internal";
import { logPipeline } from "@/lib/pipeline/log";
import { recheckReport } from "@/lib/pipeline/recheck";
import { moveReportStatus } from "@/lib/pipeline/status";
import { summarize } from "@/lib/pipeline/summary";
import { REPORT_AUDIO_BUCKET } from "@/lib/report-audio";
import { failureNeedsRerecord, isMoving, type ReportStatus } from "@/lib/report-status";
import { getRequestOrigin } from "@/lib/request-origin";
import type { Json, TablesUpdate } from "@/lib/supabase/types";

/**
 * Report detail actions (A2). Every read and write here runs as the signed-in supervisor
 * through RLS: staff may update reports, vehicles and alerts in their own organisation and
 * insert report_edits for them, and the storage policy lets org members sign their org's
 * audio. Nothing uses the service role.
 */

const APPROVABLE: ReadonlySet<ReportStatus> = new Set(["ready", "needs_clarification", "rejected"]);
const REJECTABLE: ReadonlySet<ReportStatus> = new Set(["ready", "needs_clarification", "reviewed", "failed"]);

export type ReviewState = { error?: string } | undefined;

const idSchema = z.uuid();

function reportIdFrom(formData: FormData): string | null {
  const parsed = idSchema.safeParse(String(formData.get("reportId") ?? ""));
  return parsed.success ? parsed.data : null;
}

const CHANGED = "The report changed while you were looking. Reload the page and try again.";

/**
 * Approve: status → reviewed, reviewer stamped, and the vehicle's current odometer moves to
 * this report's end reading when that is further along (the next report is checked against it).
 */
export async function approveReport(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const reportId = reportIdFrom(formData);
  if (!reportId) return { error: "This report couldn't be found." };
  const { supabase, profile } = await requireStaff();

  const { data: report } = await supabase
    .from("reports")
    .select("id, status, vehicle_id, odometer_end, vehicles(current_odometer)")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { error: "This report couldn't be found." };
  if (!APPROVABLE.has(report.status)) {
    return { error: report.status === "reviewed" ? "This report is already approved." : "Wait until the report has been processed." };
  }

  const { data: moved, error } = await supabase
    .from("reports")
    .update({ status: "reviewed", reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", report.id)
    .eq("status", report.status)
    .select("id");
  if (error) return { error: `Couldn't approve the report: ${error.message}` };
  if (!moved || moved.length === 0) return { error: CHANGED };

  const current = report.vehicles?.current_odometer ?? null;
  if (report.odometer_end !== null && (current === null || current < report.odometer_end)) {
    const { error: vehicleError } = await supabase
      .from("vehicles")
      .update({ current_odometer: report.odometer_end })
      .eq("id", report.vehicle_id);
    if (vehicleError) logPipeline({ step: "approve", reportId: report.id, outcome: "vehicle_not_updated", error: vehicleError.message });
  }

  revalidatePath("/dashboard", "layout");
  return undefined;
}

/** Reject: status → rejected, reviewer stamped. The report stays visible; the driver's list shows the chip. */
export async function rejectReport(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const reportId = reportIdFrom(formData);
  if (!reportId) return { error: "This report couldn't be found." };
  const { supabase, profile } = await requireStaff();

  const { data: report } = await supabase.from("reports").select("id, status").eq("id", reportId).maybeSingle();
  if (!report) return { error: "This report couldn't be found." };
  if (!REJECTABLE.has(report.status)) {
    return { error: report.status === "rejected" ? "This report is already rejected." : "Wait until the report has been processed." };
  }

  const { data: moved, error } = await supabase
    .from("reports")
    .update({ status: "rejected", reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq("id", report.id)
    .eq("status", report.status)
    .select("id");
  if (error) return { error: `Couldn't reject the report: ${error.message}` };
  if (!moved || moved.length === 0) return { error: CHANGED };

  revalidatePath("/dashboard", "layout");
  return undefined;
}

/**
 * Retry a failed report: back to `queued` with the retry counter cleared (as the user, under
 * the staff update policy), then one /api/process for it once this response is out, the same
 * trigger the field actions use. The driver's Today shows the outcome when it lands.
 */
export async function retryProcessing(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const reportId = reportIdFrom(formData);
  if (!reportId) return { error: "This report couldn't be found." };
  const { supabase } = await requireStaff();

  const { data: report } = await supabase.from("reports").select("id, status, source, audio_path, error").eq("id", reportId).maybeSingle();
  if (!report) return { error: "This report couldn't be found." };
  if (report.status !== "failed") {
    return { error: isMoving(report.status) ? "This report is already being processed." : "Only a report that failed can be retried." };
  }
  if (failureNeedsRerecord(report.error) || (report.source === "voice" && !report.audio_path)) {
    return { error: "There is nothing to process again. The driver needs to record this report again." };
  }

  const moved = await moveReportStatus(supabase, report.id, "failed", "queued", { requeue_count: 0, error: null, processed_at: null });
  if (!moved) return { error: CHANGED };

  const origin = await getRequestOrigin();
  after(() => triggerProcessing(report.id, { origin }));
  revalidatePath("/dashboard", "layout");
  return undefined;
}

// ---------------------------------------------------------------------------
// inline edits
// ---------------------------------------------------------------------------

export type EditResult = { ok: true; changed: boolean } | { ok: false; message: string };

const editSchema = z.object({
  reportId: z.uuid(),
  field: z.enum(EDITABLE_FIELDS),
  value: z.string().max(4000),
});

function asText(value: FieldValue): string | null {
  return value === null ? null : String(value);
}

/**
 * Saves one field: the promoted column AND `extracted` (so the raw record and the columns
 * never disagree), a report_edits row, a fresh code-built summary, then the deterministic
 * checks run again on the corrected numbers (lib/pipeline/recheck.ts).
 */
export async function editReportField(rawInput: unknown): Promise<EditResult> {
  const parsed = editSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, message: "That edit couldn't be read. Reload the page and try again." };
  const { reportId, field, value: raw } = parsed.data;

  const input = parseFieldInput(field, raw);
  if (!input.ok) return { ok: false, message: input.message };
  const newValue = input.value;

  const { supabase, profile } = await requireStaff();
  const { data: report } = await supabase
    .from("reports")
    .select("id, status, extracted, origin, destination, trip_status, odometer_start, odometer_end, fuel_liters, fuel_cost_ngn, load_type, load_tonnage")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { ok: false, message: "This report couldn't be found." };
  if (!EDITABLE_STATUSES.has(report.status)) {
    return {
      ok: false,
      message: report.status === "reviewed" ? "Approved reports can't be edited. Reject it first if something is wrong." : "Wait until the report has been processed.",
    };
  }

  const extracted = asObject(report.extracted) ?? {};
  const oldValue: FieldValue = field === "notes" ? (typeof extracted.notes === "string" ? extracted.notes : null) : report[field];
  if (sameValue(oldValue, newValue)) return { ok: true, changed: false };

  const nextExtracted: { [key: string]: Json | undefined } = { ...extracted, [field]: newValue };
  const promoted: Record<Exclude<EditableField, "notes">, FieldValue> = {
    origin: report.origin,
    destination: report.destination,
    trip_status: report.trip_status,
    odometer_start: report.odometer_start,
    odometer_end: report.odometer_end,
    fuel_liters: report.fuel_liters,
    fuel_cost_ngn: report.fuel_cost_ngn,
    load_type: report.load_type,
    load_tonnage: report.load_tonnage,
  };
  if (field !== "notes") promoted[field] = newValue;

  const patch: TablesUpdate<"reports"> = {
    extracted: nextExtracted as Json,
    summary: summarize({
      tripStatus: asText(promoted.trip_status),
      origin: asText(promoted.origin),
      destination: asText(promoted.destination),
      odometerStart: promoted.odometer_start === null ? null : Number(promoted.odometer_start),
      odometerEnd: promoted.odometer_end === null ? null : Number(promoted.odometer_end),
      fuelLiters: promoted.fuel_liters === null ? null : Number(promoted.fuel_liters),
      fuelCostNgn: promoted.fuel_cost_ngn === null ? null : Number(promoted.fuel_cost_ngn),
      loadType: asText(promoted.load_type),
      loadTonnage: promoted.load_tonnage === null ? null : Number(promoted.load_tonnage),
      incidents: incidentsFrom(nextExtracted),
    }),
  };
  if (field !== "notes") Object.assign(patch, { [field]: newValue });

  const { data: updated, error } = await supabase.from("reports").update(patch).eq("id", report.id).eq("status", report.status).select("id");
  if (error) return { ok: false, message: `Couldn't save the change: ${error.message}` };
  if (!updated || updated.length === 0) return { ok: false, message: CHANGED };

  const { error: editError } = await supabase.from("report_edits").insert({
    report_id: report.id,
    edited_by: profile.id,
    field,
    old_value: asText(oldValue),
    new_value: asText(newValue),
  });
  if (editError) logPipeline({ step: "edit", reportId: report.id, outcome: "edit_not_logged", error: editError.message });

  if (field !== "notes") {
    try {
      await recheckReport(supabase, report.id);
    } catch (caught) {
      logPipeline({ step: "recheck", reportId: report.id, outcome: "error", error: errorMessage(caught) });
    }
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true, changed: true };
}

// ---------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------

export type SignedAudio = { ok: true; url: string } | { ok: false; message: string };

const audioSchema = z.object({ reportId: z.uuid(), clarificationId: z.uuid().optional() });

/** Ten minutes on a signed URL: long enough to listen twice, short enough to be "short-lived" (spec §7). */
const AUDIO_URL_SECONDS = 600;

/** A signed URL for the report's recording, or a voice answer's, created as the user (storage RLS: own org). */
export async function signAudio(rawInput: unknown): Promise<SignedAudio> {
  const parsed = audioSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, message: "This recording couldn't be found." };
  const { reportId, clarificationId } = parsed.data;
  const { supabase } = await requireStaff();

  let path: string | null = null;
  if (clarificationId) {
    const { data } = await supabase.from("clarifications").select("answer_audio_path").eq("id", clarificationId).eq("report_id", reportId).maybeSingle();
    path = data?.answer_audio_path ?? null;
  } else {
    const { data } = await supabase.from("reports").select("audio_path").eq("id", reportId).maybeSingle();
    path = data?.audio_path ?? null;
  }
  if (!path) return { ok: false, message: "This report has no recording." };

  const { data, error } = await supabase.storage.from(REPORT_AUDIO_BUCKET).createSignedUrl(path, AUDIO_URL_SECONDS);
  if (error || !data) return { ok: false, message: "The recording couldn't be loaded. Reload the page and try again." };
  return { ok: true, url: data.signedUrl };
}
