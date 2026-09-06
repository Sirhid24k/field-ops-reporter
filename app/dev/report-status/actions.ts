"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { devToolsEnabled } from "@/lib/dev-tools";
import { createAdminClient } from "@/lib/supabase/admin";
import { Constants, type Enums } from "@/lib/supabase/types";

/**
 * Developer-only helpers for /dev/report-status. They run with the service role so a
 * signed-in driver can flip their own report through every status the pipeline will
 * produce in session 3. Every action re-checks the gate and that the report belongs to
 * the caller's organisation.
 */

const STATUSES = Constants.public.Enums.report_status;
const DEFAULT_QUESTION = "What was the odometer reading when you stopped?";

type ReportStatus = Enums<"report_status">;

function isStatus(value: string): value is ReportStatus {
  return (STATUSES as readonly string[]).includes(value);
}

async function ownedReport(formData: FormData) {
  if (!devToolsEnabled()) notFound();
  const { profile } = await requireMember();
  const reportId = String(formData.get("reportId") ?? "");
  const admin = createAdminClient();
  const { data: report } = await admin.from("reports").select("id, org_id").eq("id", reportId).maybeSingle();
  if (!report || report.org_id !== profile.org_id) notFound();
  return { admin, report };
}

export async function setStatus(formData: FormData): Promise<void> {
  const status = String(formData.get("status") ?? "");
  if (!isStatus(status)) return;
  const { admin, report } = await ownedReport(formData);

  if (status === "needs_clarification") {
    const { data: open } = await admin
      .from("clarifications")
      .select("id")
      .eq("report_id", report.id)
      .is("answered_at", null)
      .limit(1);
    if (!open || open.length === 0) {
      await admin.from("clarifications").insert({ report_id: report.id, org_id: report.org_id, question: DEFAULT_QUESTION });
    }
  }

  const terminal = status === "ready" || status === "failed" || status === "needs_clarification";
  await admin
    .from("reports")
    .update({
      status,
      processed_at: terminal ? new Date().toISOString() : null,
      error: status === "failed" ? "Flipped to failed from /dev/report-status" : null,
    })
    .eq("id", report.id);
  revalidatePath("/dev/report-status");
}

export async function askQuestion(formData: FormData): Promise<void> {
  const { admin, report } = await ownedReport(formData);
  const question = String(formData.get("question") ?? "").trim() || DEFAULT_QUESTION;
  await admin.from("clarifications").insert({ report_id: report.id, org_id: report.org_id, question });
  await admin.from("reports").update({ status: "needs_clarification", processed_at: new Date().toISOString() }).eq("id", report.id);
  revalidatePath("/dev/report-status");
}

/** Sample extracted fields so the Sent card and the detail screen have something to show. */
export async function fillSample(formData: FormData): Promise<void> {
  const { admin, report } = await ownedReport(formData);
  await admin
    .from("reports")
    .update({
      trip_status: "completed",
      origin: "Kaduna",
      destination: "Kano",
      odometer_start: 184220,
      odometer_end: 184434,
      fuel_liters: 48,
      fuel_cost_ngn: 52000,
      load_type: "Cement",
      load_tonnage: 30,
      transcript:
        "We leave Kaduna this morning with cement, reach Kano around two. Odometer na one eight four four three four. We buy fuel forty-eight litres for fifty-two thousand. No wahala on the road.",
      transcript_language: "pcm",
      summary: "Kaduna to Kano with 30 t of cement, 214 km, 48 L of fuel bought for ₦52 000. No incidents.",
      extracted: {
        trip_status: "completed",
        origin: "Kaduna",
        destination: "Kano",
        odometer_end: 184434,
        fuel_liters: 48,
        fuel_cost_ngn: 52000,
        load_type: "Cement",
        load_tonnage: 30,
        incidents: [],
        notes: null,
      },
    })
    .eq("id", report.id);
  revalidatePath("/dev/report-status");
}

export async function clearSample(formData: FormData): Promise<void> {
  const { admin, report } = await ownedReport(formData);
  await admin
    .from("reports")
    .update({
      trip_status: null,
      origin: null,
      destination: null,
      odometer_start: null,
      odometer_end: null,
      fuel_liters: null,
      fuel_cost_ngn: null,
      load_type: null,
      load_tonnage: null,
      transcript: null,
      transcript_language: null,
      summary: null,
      extracted: null,
    })
    .eq("id", report.id);
  revalidatePath("/dev/report-status");
}

/** Removes the report (clarifications cascade) and its audio, for repeat test runs. */
export async function deleteReport(formData: FormData): Promise<void> {
  const { admin, report } = await ownedReport(formData);
  const { data: files } = await admin.storage.from("report-audio").list(report.org_id, { search: report.id });
  if (files && files.length > 0) {
    await admin.storage.from("report-audio").remove(files.map((file) => `${report.org_id}/${file.name}`));
  }
  await admin.from("reports").delete().eq("id", report.id);
  revalidatePath("/dev/report-status");
}
