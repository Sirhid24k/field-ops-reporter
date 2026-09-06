import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClarifyForm } from "@/components/field/ClarifyForm";
import { BackHeader, Screen } from "@/components/field/Frame";
import { requireMember } from "@/lib/auth";
import { formatDayLong } from "@/lib/dates";

export const metadata: Metadata = { title: "One more thing" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** F4 — Clarification. Only the report's own driver can open it (RLS); nothing to answer → Today. */
export default async function ClarifyPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  if (!UUID.test(reportId)) notFound();

  const { supabase, user } = await requireMember();
  const { data: report } = await supabase
    .from("reports")
    .select("id, vehicle_id, report_date, origin, destination")
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!report) notFound();

  const { data: questions } = await supabase
    .from("clarifications")
    .select("question")
    .eq("report_id", report.id)
    .is("answered_at", null)
    .order("created_at");
  if (!questions || questions.length === 0) redirect("/app");

  const route = report.origin && report.destination ? `${report.origin} → ${report.destination}` : null;
  const summary = `Your report, ${formatDayLong(report.report_date)}${route ? `, ${route}` : ""}`;

  return (
    <Screen>
      <BackHeader title="One more thing" />
      <ClarifyForm
        reportId={report.id}
        vehicleId={report.vehicle_id}
        reportDate={report.report_date}
        summary={summary}
        questions={questions.map((row) => row.question)}
      />
    </Screen>
  );
}
