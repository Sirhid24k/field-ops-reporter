"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  AUDIO_EXTENSIONS,
  clarificationAudioPath,
  REPORT_AUDIO_BUCKET,
  reportAudioPath,
  type AudioExtension,
} from "@/lib/report-audio";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/types";

/**
 * The upload path (session-2 prompt §4). Called from the offline queue, so every action:
 *   - is idempotent: a retry after a dropped connection must not duplicate anything;
 *   - returns a value instead of redirecting: a background flush must never navigate;
 *   - checks ownership itself: field users have no update policy on reports or
 *     clarifications, so the writes that need one run with the service role, and only
 *     after the row has been read as the user and its org and status checked
 *     (see docs/session-1-notes.md and the close-out note in docs/session-2-notes.md).
 */

export type ActionFailure = {
  ok: false;
  /** unauthenticated and failed are retried by the queue; invalid and not_found are not going to succeed. */
  code: "unauthenticated" | "invalid" | "not_found" | "failed";
  message: string;
};

export type UploadTarget = { url: string; token: string; path: string };

export type CreateReportResult = ActionFailure | { ok: true; reportId: string; upload: UploadTarget | null };
export type AnswerResult = ActionFailure | { ok: true; upload: UploadTarget | null };
export type SimpleResult = ActionFailure | { ok: true };

const UNAUTHENTICATED: ActionFailure = {
  ok: false,
  code: "unauthenticated",
  message: "You're signed out. Sign in again and it will send.",
};

function invalid(message: string): ActionFailure {
  return { ok: false, code: "invalid", message };
}

function failed(message: string): ActionFailure {
  return { ok: false, code: "failed", message };
}

const audioMime = z.string().trim().max(100).nullable();
const durationSeconds = z.number().int().min(0).max(600).nullable();
const typedText = z.string().trim().max(4000).nullable();

const createSchema = z.object({
  clientUuid: z.uuid(),
  vehicleId: z.uuid(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationS: durationSeconds,
  typedNote: typedText,
  hasAudio: z.boolean(),
  mimeType: audioMime,
});

const markSchema = z.object({
  reportId: z.uuid(),
  path: z.string().min(3).max(300),
});

const answerSchema = z.object({
  reportId: z.uuid(),
  hasAudio: z.boolean(),
  mimeType: audioMime,
  durationS: durationSeconds,
  typedNote: typedText,
});

const markAnswerSchema = z.object({
  reportId: z.uuid(),
  path: z.string().min(3).max(300),
  typedNote: typedText,
});

type UserClient = Awaited<ReturnType<typeof createClient>>;
type ReportStatus = Enums<"report_status">;

const NOT_FOUND: ActionFailure = { ok: false, code: "not_found", message: "This report isn't yours or no longer exists." };

async function fieldSession() {
  const session = await getSession();
  if (!session.user || !session.profile || !session.organization) return null;
  return { supabase: session.supabase, user: session.user, organization: session.organization };
}

function extensionOf(path: string, prefix: string): AudioExtension | null {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  return (AUDIO_EXTENSIONS as readonly string[]).includes(rest) ? (rest as AudioExtension) : null;
}

async function findByClientUuid(supabase: UserClient, clientUuid: string) {
  const { data } = await supabase
    .from("reports")
    .select("id, audio_path")
    .eq("client_uuid", clientUuid)
    .maybeSingle();
  return data;
}

/**
 * The caller's own report, read as the user (RLS: own rows only) and checked against the
 * caller's org. Every service-role write below runs only after this and a status check.
 */
async function ownedReport(supabase: UserClient, userId: string, orgId: string, reportId: string) {
  const { data } = await supabase
    .from("reports")
    .select("id, org_id, status, audio_path")
    .eq("id", reportId)
    .eq("user_id", userId)
    .maybeSingle();
  return data && data.org_id === orgId ? data : null;
}

/**
 * A clarification can be answered only while the report is waiting for one and a question
 * is still open. "done" = already answered on an earlier attempt whose response was lost.
 */
function answerGate(status: ReportStatus, openQuestions: number): ActionFailure | "done" | null {
  if (openQuestions === 0) {
    return status === "needs_clarification"
      ? invalid("There's no open question on this report, so nothing was sent.")
      : "done";
  }
  if (status !== "needs_clarification") {
    return invalid(`This report isn't waiting for an answer (status ${status}), so nothing was sent.`);
  }
  return null;
}

async function signUpload(path: string): Promise<UploadTarget | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(REPORT_AUDIO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return null;
  return { url: data.signedUrl, token: data.token, path: data.path };
}

async function objectExists(path: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(REPORT_AUDIO_BUCKET).exists(path);
  return !error && data === true;
}

/**
 * Creates the `reports` row (status queued) and, for a voice report, a signed URL for
 * `report-audio/{orgId}/{reportId}.{ext}`. Idempotent on (org_id, client_uuid): a retry
 * gets the same report back, with a fresh upload URL if the audio never arrived.
 */
export async function createReport(rawInput: unknown): Promise<CreateReportResult> {
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) return invalid("This report is missing something and can't be sent.");
  const input = parsed.data;
  if (!input.hasAudio && !input.typedNote) return invalid("Record something or type a note first.");

  const session = await fieldSession();
  if (!session) return UNAUTHENTICATED;
  const { supabase, user, organization } = session;

  let report = await findByClientUuid(supabase, input.clientUuid);

  if (!report) {
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id")
      .eq("id", input.vehicleId)
      .eq("org_id", organization.id)
      .maybeSingle();
    if (!vehicle) return { ok: false, code: "not_found", message: "That vehicle is no longer in your organisation." };

    const { data: inserted, error } = await supabase
      .from("reports")
      .insert({
        client_uuid: input.clientUuid,
        org_id: organization.id,
        user_id: user.id,
        vehicle_id: input.vehicleId,
        report_date: input.reportDate,
        status: "queued",
        source: input.hasAudio ? "voice" : "text",
        typed_note: input.typedNote,
        audio_duration_s: input.hasAudio ? input.durationS : null,
      })
      .select("id, audio_path")
      .single();

    if (error?.code === "23505") {
      // a retry raced this one; the first insert won
      report = await findByClientUuid(supabase, input.clientUuid);
    } else if (error || !inserted) {
      return failed("Couldn't save the report. It's saved on your phone and will retry.");
    } else {
      report = inserted;
      if (!input.hasAudio) {
        // SESSION 3: fire /api/process?report_id=${report.id} — a typed-only report is complete on insert.
      }
    }
    if (!report) return failed("Couldn't save the report. It's saved on your phone and will retry.");
  }

  if (!input.hasAudio || report.audio_path) return { ok: true, reportId: report.id, upload: null };

  const upload = await signUpload(reportAudioPath(organization.id, report.id, input.mimeType));
  if (!upload) return failed("Couldn't prepare the upload. It's saved on your phone and will retry.");
  return { ok: true, reportId: report.id, upload };
}

/** Stores `audio_path` once the blob is in storage. Runs after the client's PUT to the signed URL. */
export async function markUploaded(rawInput: unknown): Promise<SimpleResult> {
  const parsed = markSchema.safeParse(rawInput);
  if (!parsed.success) return invalid("That upload can't be confirmed.");
  const { reportId, path } = parsed.data;

  const session = await fieldSession();
  if (!session) return UNAUTHENTICATED;
  const { supabase, user, organization } = session;

  const report = await ownedReport(supabase, user.id, organization.id, reportId);
  if (!report) return NOT_FOUND;
  if (report.audio_path === path) return { ok: true }; // confirmed on an earlier attempt
  if (report.status !== "queued" || report.audio_path !== null) {
    return invalid(`This report isn't waiting for a recording (status ${report.status}), so the upload wasn't attached.`);
  }

  if (!extensionOf(path, `${organization.id}/${report.id}.`)) return invalid("That upload path isn't valid.");
  if (!(await objectExists(path))) return failed("The recording didn't reach the server. It will retry.");

  const admin = createAdminClient();
  const { error } = await admin.from("reports").update({ audio_path: path }).eq("id", report.id);
  if (error) return failed("Couldn't confirm the upload. It will retry.");

  // SESSION 3: fire /api/process?report_id=${report.id} — the audio is in storage; processing can start.
  return { ok: true };
}

async function openQuestions(supabase: UserClient, reportId: string) {
  const { data } = await supabase
    .from("clarifications")
    .select("id, answered_at")
    .eq("report_id", reportId)
    .order("created_at");
  const rows = data ?? [];
  return {
    open: rows.filter((row) => row.answered_at === null),
    rounds: new Set(rows.map((row) => row.answered_at).filter(Boolean)).size,
  };
}

/** Stamps every open question on the report as answered and puts the report back in the queue. */
async function completeAnswer(
  reportId: string,
  answer: { text: string | null; audioPath: string | null },
): Promise<boolean> {
  const admin = createAdminClient();
  const answeredAt = new Date().toISOString();
  const { error: clarificationError } = await admin
    .from("clarifications")
    .update({ answer_text: answer.text, answer_audio_path: answer.audioPath, answered_at: answeredAt })
    .eq("report_id", reportId)
    .is("answered_at", null);
  if (clarificationError) return false;

  const { error: reportError } = await admin.from("reports").update({ status: "queued" }).eq("id", reportId);
  if (reportError) return false;

  // SESSION 3: fire /api/process?report_id=${reportId} — the answer is in; reprocess from queued.
  return true;
}

/**
 * Answers the open clarification(s) on a report. A typed answer completes here; a voice
 * answer gets a signed URL for `report-audio/{orgId}/{reportId}-clarify-{n}.{ext}` and
 * completes in `markAnswerUploaded`. Both leave the report in status queued.
 */
export async function answerClarification(rawInput: unknown): Promise<AnswerResult> {
  const parsed = answerSchema.safeParse(rawInput);
  if (!parsed.success) return invalid("This answer is missing something and can't be sent.");
  const input = parsed.data;
  if (!input.hasAudio && !input.typedNote) return invalid("Say or type your answer first.");

  const session = await fieldSession();
  if (!session) return UNAUTHENTICATED;
  const { supabase, user, organization } = session;

  const report = await ownedReport(supabase, user.id, organization.id, input.reportId);
  if (!report) return NOT_FOUND;

  const questions = await openQuestions(supabase, report.id);
  const gate = answerGate(report.status, questions.open.length);
  if (gate === "done") return { ok: true, upload: null }; // answered on an earlier attempt
  if (gate) return gate;

  if (!input.hasAudio) {
    const done = await completeAnswer(report.id, { text: input.typedNote, audioPath: null });
    return done ? { ok: true, upload: null } : failed("Couldn't save the answer. It's saved on your phone and will retry.");
  }

  const upload = await signUpload(clarificationAudioPath(organization.id, report.id, questions.rounds + 1, input.mimeType));
  if (!upload) return failed("Couldn't prepare the upload. It's saved on your phone and will retry.");
  return { ok: true, upload };
}

/** Completes a voice answer once its blob is in storage. */
export async function markAnswerUploaded(rawInput: unknown): Promise<SimpleResult> {
  const parsed = markAnswerSchema.safeParse(rawInput);
  if (!parsed.success) return invalid("That upload can't be confirmed.");
  const { reportId, path, typedNote } = parsed.data;

  const session = await fieldSession();
  if (!session) return UNAUTHENTICATED;
  const { supabase, user, organization } = session;

  const report = await ownedReport(supabase, user.id, organization.id, reportId);
  if (!report) return NOT_FOUND;

  const questions = await openQuestions(supabase, report.id);
  const gate = answerGate(report.status, questions.open.length);
  if (gate === "done") return { ok: true }; // completed on an earlier attempt
  if (gate) return gate;

  const prefix = `${organization.id}/${report.id}-clarify-`;
  const valid = path.startsWith(prefix) && /^\d+\.(webm|m4a|ogg)$/.test(path.slice(prefix.length));
  if (!valid) return invalid("That upload path isn't valid.");
  if (!(await objectExists(path))) return failed("The recording didn't reach the server. It will retry.");

  const done = await completeAnswer(report.id, { text: typedNote, audioPath: path });
  return done ? { ok: true } : failed("Couldn't save the answer. It will retry.");
}
