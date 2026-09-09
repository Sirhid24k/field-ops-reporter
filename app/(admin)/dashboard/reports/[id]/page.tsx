import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudioPlayer } from "@/components/admin/AudioPlayer";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { FieldList, type FieldRowView } from "@/components/admin/FieldList";
import { RetryProcessing } from "@/components/admin/RetryProcessing";
import { ReviewButtons } from "@/components/admin/ReviewButtons";
import { StatusChip } from "@/components/ui";
import { chipForRow } from "@/lib/admin/board";
import {
  asObject,
  EDITABLE_STATUSES,
  flaggedFields,
  formatFieldValue,
  incidentLine,
  incidentsFrom,
  parseValidation,
  type ValidationView,
} from "@/lib/admin/report-fields";
import { requireStaff } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { dateInZone, formatClock, formatDateTime, formatDayShort } from "@/lib/dates";
import { formatGrouped } from "@/lib/format";
import { failureNeedsRerecord, isMoving } from "@/lib/report-status";

export const metadata: Metadata = { title: "Report" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Odometer moved forward, 184 220 → 184 434." → "Odometer moved forward, 184 220 → 184 434 — passed" */
function CheckLine({ result }: { result: ValidationView }) {
  const message = result.message.replace(/\.\s*$/, "");
  const verdict = result.skipped ? "not checked" : result.passed ? "passed" : "check";
  return (
    <li className={cn("text-body", result.skipped ? "text-steel" : result.passed ? "text-convoy" : "text-flag")}>
      {message} — {verdict}
    </li>
  );
}

/** A2 Report detail: what the driver said on the left, what the system understood on the right. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { supabase, organization } = await requireStaff();
  const { data: report } = await supabase
    .from("reports")
    .select(
      "*, vehicles(plate_number, label, current_odometer), profiles!reports_user_id_fkey(full_name), reviewer:profiles!reports_reviewed_by_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!report) notFound();

  const [{ data: clarifications }, { data: alerts }, { data: edits }] = await Promise.all([
    supabase
      .from("clarifications")
      .select("id, question, answer_text, answer_audio_path, answer_transcript, answered_at")
      .eq("report_id", report.id)
      .order("created_at"),
    supabase.from("alerts").select("id, status").eq("report_id", report.id),
    supabase.from("report_edits").select("field").eq("report_id", report.id),
  ]);

  const timezone = organization.timezone;
  const todayIso = dateInZone(new Date(), timezone);
  const moving = isMoving(report.status);
  const openAlerts = (alerts ?? []).filter((alert) => alert.status === "open").length;
  const chip = chipForRow({ status: report.status, openAlerts });
  const extracted = asObject(report.extracted);
  const validation = parseValidation(report.validation);
  const flagged = flaggedFields(validation);
  const edited = new Set((edits ?? []).map((edit) => edit.field));
  const incidents = incidentsFrom(extracted);
  const notes = typeof extracted?.notes === "string" ? extracted.notes : null;
  const canEdit = EDITABLE_STATUSES.has(report.status);
  const rerecord = failureNeedsRerecord(report.error) || (report.source === "voice" && !report.audio_path);
  const startFromLastReading = extracted !== null && extracted.odometer_start === null && report.odometer_start !== null && !edited.has("odometer_start");
  // the pipeline multiplies litres by the quoted price per litre when the driver gave no total
  const pricePerLitre = typeof extracted?.fuel_price_per_l_ngn === "number" ? extracted.fuel_price_per_l_ngn : null;
  const costFromPrice =
    pricePerLitre !== null && extracted?.fuel_cost_ngn === null && report.fuel_cost_ngn !== null && report.fuel_liters !== null && !edited.has("fuel_cost_ngn")
      ? `${formatFieldValue("fuel_liters", report.fuel_liters)} × ₦${formatGrouped(pricePerLitre)} per litre`
      : null;

  const route =
    report.origin && report.destination ? `${report.origin} → ${report.destination}` : report.origin ? `From ${report.origin}` : report.destination ? `To ${report.destination}` : null;
  const load = [report.load_type, formatFieldValue("load_tonnage", report.load_tonnage)].filter(Boolean).join(", ") || null;

  const rows: FieldRowView[] = [
    {
      key: "route",
      label: "Route",
      display: route,
      parts: [
        { field: "origin", value: report.origin },
        { field: "destination", value: report.destination },
      ],
      numeric: false,
      flagged: false,
      edited: edited.has("origin") || edited.has("destination"),
    },
    {
      key: "trip_status",
      label: "Trip status",
      display: formatFieldValue("trip_status", report.trip_status),
      parts: [{ field: "trip_status", value: report.trip_status }],
      numeric: false,
      flagged: false,
      edited: edited.has("trip_status"),
    },
    {
      key: "odometer_start",
      label: "Odometer start",
      display: formatFieldValue("odometer_start", report.odometer_start),
      parts: [{ field: "odometer_start", value: report.odometer_start }],
      numeric: true,
      flagged: flagged.has("odometer_start"),
      edited: edited.has("odometer_start"),
      note: startFromLastReading ? "from last reading" : null,
    },
    {
      key: "odometer_end",
      label: "Odometer end",
      display: formatFieldValue("odometer_end", report.odometer_end),
      parts: [{ field: "odometer_end", value: report.odometer_end }],
      numeric: true,
      flagged: flagged.has("odometer_end"),
      edited: edited.has("odometer_end"),
    },
    {
      key: "distance",
      label: "Distance",
      display: formatFieldValue("distance", report.distance_km),
      parts: [],
      numeric: true,
      flagged: flagged.has("distance"),
      edited: false,
    },
    {
      key: "fuel_liters",
      label: "Fuel",
      display: formatFieldValue("fuel_liters", report.fuel_liters),
      parts: [{ field: "fuel_liters", value: report.fuel_liters }],
      numeric: true,
      flagged: flagged.has("fuel_liters"),
      edited: edited.has("fuel_liters"),
    },
    {
      key: "fuel_cost_ngn",
      label: "Fuel cost",
      display: formatFieldValue("fuel_cost_ngn", report.fuel_cost_ngn),
      parts: [{ field: "fuel_cost_ngn", value: report.fuel_cost_ngn }],
      numeric: true,
      flagged: flagged.has("fuel_cost_ngn"),
      edited: edited.has("fuel_cost_ngn"),
      note: costFromPrice,
    },
    {
      key: "load",
      label: "Load",
      display: load,
      parts: [
        { field: "load_type", value: report.load_type },
        { field: "load_tonnage", value: report.load_tonnage },
      ],
      numeric: false,
      flagged: flagged.has("load_tonnage"),
      edited: edited.has("load_type") || edited.has("load_tonnage"),
    },
    {
      key: "incidents",
      label: "Incidents",
      display: incidents.length > 0 ? incidents.map(incidentLine).join(" ") : extracted ? "None" : null,
      parts: [],
      numeric: false,
      flagged: false,
      edited: false,
    },
    {
      key: "notes",
      label: "Notes",
      display: notes,
      parts: [{ field: "notes", value: notes }],
      numeric: false,
      flagged: false,
      edited: edited.has("notes"),
    },
  ];

  return (
    <>
      <p>
        <Link href="/dashboard" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-body-lg text-steel hover:text-ink">
          <span aria-hidden="true" className="font-display text-heading leading-none">
            ‹
          </span>
          Today
        </Link>
      </p>

      <header className="mt-1">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-title font-bold tabular">{report.vehicles?.plate_number ?? "Unknown vehicle"}</h1>
          {report.profiles?.full_name ? <span className="text-body-lg">{report.profiles.full_name}</span> : null}
          <span className="font-display text-body-lg font-semibold text-steel tabular">{formatDayShort(report.report_date)}</span>
          {chip.kind === "chip" ? (
            <StatusChip status={chip.status} surface="admin" count={chip.count} className="self-center" />
          ) : (
            <span className="font-display text-body font-semibold text-flag">{chip.label}</span>
          )}
        </div>
        <p className="mt-1 text-caption text-steel">
          Sent {formatDateTime(report.submitted_at, timezone, report.report_date)}, {report.source === "voice" ? "from phone" : "typed on phone"}
        </p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-10 min-[900px]:grid-cols-12 min-[900px]:gap-8">
        <section className="min-w-0 min-[900px]:col-span-7">
          <h2 className="font-display text-heading font-bold">What the driver said</h2>

          {report.audio_path ? (
            <div className="mt-4">
              <AudioPlayer reportId={report.id} durationS={report.audio_duration_s} />
            </div>
          ) : null}

          {report.transcript_language ? (
            <p className="mt-4">
              <span className="inline-flex min-h-6 items-center rounded-control border border-ink px-2 font-display text-body font-semibold leading-5">
                {report.transcript_language}
              </span>
            </p>
          ) : null}

          {report.transcript ? (
            <p className="mt-4 max-w-[64ch] text-body-lg leading-[1.75] whitespace-pre-line">{report.transcript}</p>
          ) : moving ? (
            <p className="mt-4 text-body-lg text-steel">
              <span className="animate-text-pulse">Processing</span>
            </p>
          ) : report.source === "voice" ? (
            <p className="mt-4 text-body-lg text-steel">No transcript.</p>
          ) : null}

          {report.typed_note && report.source === "voice" ? (
            <>
              <p className="mt-5 text-caption text-steel">Typed note</p>
              <p className="mt-1 max-w-[64ch] text-body-lg leading-[1.75] whitespace-pre-line">{report.typed_note}</p>
            </>
          ) : null}

          {report.status === "failed" ? (
            <div className="mt-5 border-l-4 border-flag bg-flag/12 px-3 py-3">
              <p className="text-body">This report couldn&rsquo;t be processed{report.error ? `: ${report.error}` : "."}</p>
              {rerecord ? (
                <p className="mt-1 text-body text-steel">The driver needs to record it again; their phone says so.</p>
              ) : (
                <>
                  <p className="mt-1 text-body text-steel">
                    {report.source === "voice" ? "The recording is still here." : "The typed report is still here."} Retry runs it through the pipeline
                    again; this page and the driver&rsquo;s phone update on their own.
                  </p>
                  <RetryProcessing reportId={report.id} />
                </>
              )}
            </div>
          ) : null}

          {clarifications && clarifications.length > 0 ? (
            <div className="mt-8">
              <h2 className="font-display text-heading font-bold">Clarification</h2>
              <ol className="mt-3 space-y-4">
                {clarifications.map((row) => {
                  const answer = row.answer_text?.trim() || row.answer_transcript?.trim() || null;
                  return (
                    <li key={row.id}>
                      <p className="border-l-4 border-hazard bg-hazard/12 px-3 py-2 text-body-lg">
                        <span className="font-display font-semibold">Q</span> {row.question}
                      </p>
                      {row.answered_at ? (
                        <div className="mt-2 px-3">
                          <p className="text-body-lg">
                            <span className="font-display font-semibold">A</span>{" "}
                            {answer ? <>&ldquo;{answer}&rdquo;</> : <span className="text-steel">Answered by voice</span>}{" "}
                            <span className="text-caption text-steel">answered {formatDateTime(row.answered_at, timezone, todayIso)}</span>
                          </p>
                          {row.answer_audio_path ? (
                            <div className="mt-2">
                              <AudioPlayer reportId={report.id} clarificationId={row.id} durationS={null} label="Answer" />
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-2 px-3 text-body text-steel">Waiting for the driver&rsquo;s answer.</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </section>

        <section className="min-w-0 min-[900px]:col-span-5">
          <h2 className="font-display text-heading font-bold">What the system understood</h2>
          {report.summary ? <p className="mt-2 text-body text-steel">{report.summary}</p> : null}
          {moving && !extracted ? (
            <p className="mt-4 text-body-lg text-steel">
              <span className="animate-text-pulse">Processing</span>
            </p>
          ) : (
            <FieldList reportId={report.id} rows={rows} canEdit={canEdit} />
          )}

          <h3 className="mt-8 font-display text-heading font-bold">Checks</h3>
          {validation && validation.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {validation.map((result) => (
                <CheckLine key={result.rule} result={result} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-body text-steel">
              {moving ? "The checks run once the report is processed." : "No checks were recorded for this report."}
            </p>
          )}

          {report.reviewed_at && (report.status === "reviewed" || report.status === "rejected") ? (
            <p className="mt-6 text-body text-steel">
              {report.status === "reviewed" ? "Approved" : "Rejected"} by {report.reviewer?.full_name ?? "a supervisor"},{" "}
              {formatDateTime(report.reviewed_at, timezone, todayIso)}
              {report.status === "reviewed" && report.odometer_end !== null && report.vehicles?.current_odometer === report.odometer_end
                ? `. Vehicle odometer now ${formatFieldValue("odometer_end", report.odometer_end)}.`
                : "."}
            </p>
          ) : null}

          <ReviewButtons reportId={report.id} status={report.status} />
          {moving ? (
            <>
              <p className="mt-6 text-body text-steel">Processing. Sent {formatClock(report.submitted_at, timezone)}. This page updates on its own.</p>
              <AutoRefresh />
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
