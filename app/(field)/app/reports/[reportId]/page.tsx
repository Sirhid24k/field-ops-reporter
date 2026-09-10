import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BackHeader, Screen } from "@/components/field/Frame";
import { StatusChip } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { formatClock, formatDayLong } from "@/lib/dates";
import { formatGrouped } from "@/lib/format";
import { chipForStatus, isMoving } from "@/lib/report-status";
import type { Json } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Report" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonObject = { [key: string]: Json | undefined };

function asObject(value: Json | null): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function incidentsFrom(extracted: JsonObject | null): string | null {
  const list = extracted?.incidents;
  if (!Array.isArray(list) || list.length === 0) return null;
  const lines = list
    .map((entry) => asObject(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .map((entry) => {
      const type = typeof entry.type === "string" ? entry.type : "incident";
      const description = typeof entry.description === "string" ? entry.description : "";
      return description ? `${type}: ${description}` : type;
    });
  return lines.length > 0 ? lines.join(" ") : null;
}

/** F5 detail — read-only: the transcript and the fields as the office saw them. */
export default async function ReportDetailPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  if (!UUID.test(reportId)) notFound();

  const { supabase, user, organization } = await requireMember();
  const { data: report } = await supabase
    .from("reports")
    .select(
      "id, report_date, submitted_at, status, source, typed_note, transcript, transcript_language, trip_status, origin, destination, odometer_start, odometer_end, distance_km, fuel_liters, fuel_cost_ngn, load_type, load_tonnage, extracted, summary, vehicles(plate_number, label)",
    )
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!report) notFound();

  const { data: clarifications } = await supabase
    .from("clarifications")
    .select("id, question, answer_text, answer_audio_path, answered_at")
    .eq("report_id", report.id)
    .order("created_at");

  const chip = chipForStatus(report.status);
  const moving = isMoving(report.status);
  const extracted = asObject(report.extracted);
  const notes = typeof extracted?.notes === "string" ? extracted.notes : null;

  const fields: Array<[string, string | null]> = [
    ["Route", report.origin && report.destination ? `${report.origin} → ${report.destination}` : null],
    ["Trip status", report.trip_status],
    ["Odometer start", report.odometer_start !== null ? formatGrouped(report.odometer_start) : null],
    ["Odometer end", report.odometer_end !== null ? formatGrouped(report.odometer_end) : null],
    ["Distance", report.distance_km !== null ? `${formatGrouped(report.distance_km)} km` : null],
    ["Fuel", report.fuel_liters !== null ? `${formatGrouped(report.fuel_liters, { maximumFractionDigits: 1 })} L` : null],
    ["Fuel cost", report.fuel_cost_ngn !== null ? `₦${formatGrouped(report.fuel_cost_ngn)}` : null],
    [
      "Load",
      report.load_type || report.load_tonnage !== null
        ? [report.load_type, report.load_tonnage !== null ? `${formatGrouped(report.load_tonnage, { maximumFractionDigits: 1 })} t` : null]
            .filter(Boolean)
            .join(", ")
        : null,
    ],
    ["Incidents", incidentsFrom(extracted)],
    ["Notes", notes],
  ];

  return (
    <Screen>
      <BackHeader title={formatDayLong(report.report_date)} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {report.vehicles ? (
          <span className="font-display text-heading font-bold tabular">{report.vehicles.plate_number}</span>
        ) : null}
        {chip ? <StatusChip status={chip} /> : <span className="text-caption text-flag">Not processed</span>}
      </div>
      <p className="mt-1 text-caption text-steel">
        Sent {formatClock(report.submitted_at, organization.timezone)}, {report.source === "voice" ? "by voice" : "typed"}
      </p>

      <section className="mt-8">
        <h2 className="font-display text-heading font-bold">What you said</h2>
        {report.transcript_language ? (
          <p className="mt-3">
            <span className="inline-flex min-h-6 items-center rounded-control border border-ink px-2 font-display text-body font-semibold leading-5">
              {report.transcript_language}
            </span>
          </p>
        ) : null}
        {report.transcript ? (
          <p className="mt-3 text-body-lg leading-7">{report.transcript}</p>
        ) : moving ? (
          <p className="mt-3 text-body-lg text-steel">
            <span className="animate-text-pulse">Processing</span>
          </p>
        ) : report.source === "voice" ? (
          <p className="mt-3 text-body-lg text-steel">No transcript.</p>
        ) : null}
        {report.typed_note ? (
          <>
            <p className="mt-4 text-caption text-steel">Typed note</p>
            <p className="mt-1 text-body-lg leading-7">{report.typed_note}</p>
          </>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-heading font-bold">What the office saw</h2>
        {report.summary ? <p className="mt-3 text-body-lg">{report.summary}</p> : null}
        <dl className="mt-3 divide-y divide-line border-y border-line">
          {fields.map(([label, value]) => (
            <div key={label} className="flex min-h-12 items-baseline justify-between gap-4 py-2">
              <dt className="text-body text-steel">{label}</dt>
              <dd className="text-right font-display text-body-lg font-semibold tabular">
                {value ?? (moving ? <span className="font-body font-normal text-steel">Processing</span> : "—")}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {clarifications && clarifications.length > 0 ? (
        <section className="mt-8 mb-8">
          <h2 className="font-display text-heading font-bold">Questions from the office</h2>
          <ul className="mt-3 space-y-4">
            {clarifications.map((row) => (
              <li key={row.id} className="border-l-4 border-hazard pl-3">
                <p className="text-body-lg">{row.question}</p>
                <p className="mt-1 text-body text-steel">
                  {row.answered_at
                    ? row.answer_text
                      ? `You answered: ${row.answer_text}`
                      : row.answer_audio_path
                        ? `You answered by voice, ${formatClock(row.answered_at, organization.timezone)}`
                        : "Answered"
                    : "Not answered yet"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mb-8" />
      )}
    </Screen>
  );
}
