import type { Metadata } from "next";
import { FieldHeader, Screen } from "@/components/field/Frame";
import { TodayCard, type TodayReport } from "@/components/field/TodayCard";
import { requireMember } from "@/lib/auth";
import { dateInZone } from "@/lib/dates";
import { firstName, formatTime12h } from "@/lib/format";
import { failureNeedsRerecord, olderReportsWaiting } from "@/lib/report-status";

export const metadata: Metadata = { title: "Today" };

/** F2 — Today. Reads today's rows as the user (RLS); the card itself is client-side. */
export default async function TodayPage() {
  const { supabase, user, profile, organization } = await requireMember();
  const todayIso = dateInZone(new Date(), organization.timezone);

  const [{ data: vehicles }, { data: reports }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, label, default_driver_id")
      .eq("org_id", organization.id)
      .eq("active", true)
      .order("created_at"),
    supabase
      .from("reports")
      .select("id, vehicle_id, status, submitted_at, report_date, origin, destination, distance_km, source, audio_path, error")
      .eq("user_id", user.id)
      .eq("report_date", todayIso)
      .order("submitted_at", { ascending: false }),
  ]);

  // the office's questions on earlier reports are reachable from here too (Today's card only covers today's report)
  const { data: earlier } = await supabase
    .from("reports")
    .select("id, report_date, status")
    .eq("user_id", user.id)
    .eq("status", "needs_clarification")
    .lt("report_date", todayIso)
    .order("report_date");

  const questions = new Map<string, string[]>();
  const needing = [...(reports ?? []).filter((report) => report.status === "needs_clarification"), ...(earlier ?? [])].map((report) => report.id);
  if (needing.length > 0) {
    const { data: clarifications } = await supabase
      .from("clarifications")
      .select("report_id, question")
      .in("report_id", needing)
      .is("answered_at", null)
      .order("created_at");
    for (const row of clarifications ?? []) {
      questions.set(row.report_id, [...(questions.get(row.report_id) ?? []), row.question]);
    }
  }
  const older = olderReportsWaiting(
    (earlier ?? []).map((report) => ({ ...report, open_questions: questions.get(report.id)?.length ?? 0 })),
    todayIso,
  );

  const list = vehicles ?? [];
  const defaultVehicleId = list.find((vehicle) => vehicle.default_driver_id === profile.id)?.id ?? list[0]?.id ?? null;
  const todayReports: TodayReport[] = (reports ?? []).map(({ source, audio_path, error, ...report }) => ({
    ...report,
    question: questions.get(report.id)?.join(" ") ?? null,
    // a failure only the driver can fix: nothing was heard, or there is no recording to retry
    rerecord: failureNeedsRerecord(error) || (source === "voice" && audio_path === null),
  }));

  return (
    <Screen>
      <FieldHeader orgName={organization.name} firstName={firstName(profile.full_name)} />
      <TodayCard
        vehicles={list.map(({ id, plate_number, label }) => ({ id, plate_number, label }))}
        defaultVehicleId={defaultVehicleId}
        reports={todayReports}
        olderQuestions={older ? { reportId: older.oldest.id, reportDate: older.oldest.report_date, questions: older.oldest.open_questions, waiting: older.waiting } : null}
        todayIso={todayIso}
        timezone={organization.timezone}
        cutoffLabel={formatTime12h(organization.report_cutoff_time)}
      />
    </Screen>
  );
}
