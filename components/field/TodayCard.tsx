"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { buttonClassName, OdometerDigits, StatusChip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateInZone, formatClock, formatDayLong } from "@/lib/dates";
import { isMoving, todayVariantFor, type ReportStatus, type TodayVariant } from "@/lib/report-status";
import { readVehicleChoice, setVehicleChoice, subscribeVehicleChoice } from "@/lib/vehicle-choice";
import { BottomZone } from "./Frame";
import { useFieldNetwork } from "./FieldShell";
import { VehicleSheet, type VehicleOption } from "./VehicleSheet";

export type TodayReport = {
  id: string;
  vehicle_id: string;
  status: ReportStatus;
  submitted_at: string;
  report_date: string;
  origin: string | null;
  destination: string | null;
  distance_km: number | null;
  /** The open clarification question(s), when status is needs_clarification. */
  question: string | null;
  /** When status is failed: true if only a new recording can fix it, false if the office retries the one that is there. */
  rerecord: boolean;
};

export type TodayCardProps = {
  vehicles: VehicleOption[];
  /** The vehicle whose default driver is this user, else the org's first vehicle. */
  defaultVehicleId: string | null;
  /** Today's reports by this user, newest first. */
  reports: TodayReport[];
  todayIso: string;
  timezone: string;
  /** "8:00 pm" */
  cutoffLabel: string;
};

const POLL_MS = 5_000;

function subscribeToClock(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

/**
 * F2: the date, the vehicle chip, the status card in every variant and the primary action.
 * Client-side because the state comes from three places: the server's rows, the offline
 * queue on this phone, and which vehicle the driver last picked.
 */
export function TodayCard({ vehicles, defaultVehicleId, reports, todayIso: serverToday, timezone, cutoffLabel }: TodayCardProps) {
  const router = useRouter();
  const { pending, pendingLoaded, lastSentAt } = useFieldNetwork();
  const [sheetOpen, setSheetOpen] = useState(false);

  // the phone's idea of today wins over a shell page that was cached earlier
  const todayIso = useSyncExternalStore(subscribeToClock, () => dateInZone(new Date(), timezone), () => serverToday);
  const stored = useSyncExternalStore(subscribeVehicleChoice, readVehicleChoice, () => null);
  const vehicleId = stored && vehicles.some((vehicle) => vehicle.id === stored) ? stored : defaultVehicleId;
  const vehicle = vehicles.find((entry) => entry.id === vehicleId) ?? null;

  const report = reports.find((entry) => entry.vehicle_id === vehicleId && entry.report_date === todayIso) ?? null;
  const pendingHere = pending.find(
    (item) =>
      item.reportDate === todayIso &&
      (item.kind === "report" ? item.vehicleId === vehicleId : Boolean(report) && item.reportId === report?.id),
  );

  // server rows first (so the page is right before hydration); the queue on this phone overrides once read
  const variant: TodayVariant =
    pendingLoaded && pendingHere ? "queued" : report ? todayVariantFor(report.status) : "not_reported";

  // poll while the pipeline is moving the report; stop on a terminal status
  const reportId = report?.id ?? null;
  const moving = report ? isMoving(report.status) : false;
  useEffect(() => {
    if (!reportId || !moving) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reportId, moving, router]);

  // the queue just sent something: pick up the new row
  useEffect(() => {
    if (lastSentAt) router.refresh();
  }, [lastSentAt, router]);

  const action = (() => {
    if (!vehicle) return null;
    if (variant === "needs_answer" && report) {
      return { href: `/app/clarify/${report.id}`, label: "Answer question", style: "primary" as const };
    }
    if (variant === "queued" || variant === "processing" || variant === "sent") {
      return { href: "/app/new", label: "Record another", style: "secondary" as const };
    }
    // a failure on our side keeps the recording; the office retries it, so no re-record is asked for
    if (variant === "failed" && report && !report.rerecord) {
      return { href: "/app/new", label: "Record another", style: "secondary" as const };
    }
    return { href: "/app/new", label: "Record today’s report", style: "primary" as const };
  })();

  return (
    <>
      <h1 className="mt-7 font-display text-title font-bold">{formatDayLong(todayIso)}</h1>

      {vehicle ? (
        vehicles.length > 1 ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-control border border-ink px-3"
          >
            <span className="font-display text-heading font-bold tabular">{vehicle.plate_number}</span>
            {vehicle.label ? <span className="text-body text-steel">{vehicle.label}</span> : null}
          </button>
        ) : (
          <p className="mt-3 flex min-h-12 items-center gap-2">
            <span className="font-display text-heading font-bold tabular">{vehicle.plate_number}</span>
            {vehicle.label ? <span className="text-body text-steel">{vehicle.label}</span> : null}
          </p>
        )
      ) : (
        <p className="mt-3 min-h-12 text-body text-steel">No vehicle yet. Ask the office to add one.</p>
      )}

      <section
        aria-live="polite"
        className={cn(
          "mt-6 min-h-28 px-4 py-4",
          variant === "needs_answer"
            ? "border-l-4 border-hazard bg-hazard/12"
            : variant === "failed"
              ? "border-l-4 border-flag bg-flag/12"
              : "border border-line",
        )}
      >
        <CardBody variant={variant} report={report} cutoffLabel={cutoffLabel} timezone={timezone} />
      </section>

      <Link href="/app/reports" className="mt-6 flex min-h-14 items-center justify-between border-b border-line text-body-lg">
        My reports
        <span aria-hidden="true" className="font-display text-heading">
          ›
        </span>
      </Link>

      <BottomZone>
        {action ? (
          <Link href={action.href} className={buttonClassName({ variant: action.style, size: "field", block: true })}>
            {action.label}
          </Link>
        ) : (
          <span aria-disabled="true" className={buttonClassName({ size: "field", block: true, disabled: true })}>
            Record today&rsquo;s report
          </span>
        )}
      </BottomZone>

      <VehicleSheet
        open={sheetOpen}
        vehicles={vehicles}
        selectedId={vehicleId}
        onSelect={(id) => {
          setVehicleChoice(id);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

function OfflineGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-1 size-4 shrink-0 text-steel"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M3.5 12.5l9-9" />
    </svg>
  );
}

/** Exact copy from design-brief §4/F2 for each variant. */
function CardBody({
  variant,
  report,
  cutoffLabel,
  timezone,
}: {
  variant: TodayVariant;
  report: TodayReport | null;
  cutoffLabel: string;
  timezone: string;
}) {
  switch (variant) {
    case "not_reported":
      return (
        <>
          <StatusChip status="not_reported" />
          <p className="mt-3 text-body-lg">Send your report before {cutoffLabel}</p>
        </>
      );
    case "queued":
      return (
        <>
          <StatusChip status="queued" />
          <p className="mt-3 flex items-start gap-2 text-body-lg">
            <OfflineGlyph />
            <span>Queued. Sends when you&rsquo;re back online.</span>
          </p>
        </>
      );
    case "processing":
      return (
        <>
          <StatusChip status="processing" />
          <p className="mt-3 text-body-lg">Sending… the office will see it in a minute.</p>
        </>
      );
    case "needs_answer":
      return (
        <>
          <StatusChip status="needs_answer" />
          <p className="mt-3 text-body-lg">{report?.question ?? "The office has a question about this report."}</p>
        </>
      );
    case "sent": {
      const time = report ? formatClock(report.submitted_at, timezone) : "";
      const route = report?.origin && report?.destination ? `${report.origin} → ${report.destination}` : null;
      const km = report?.distance_km ?? null;
      return (
        <>
          <StatusChip status={report?.status === "reviewed" ? "approved" : "sent"} />
          <p className="mt-3 text-body-lg">Sent {time}.</p>
          {route || km !== null ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {route ? (
                <span className="text-body-lg">
                  {route}
                  {km !== null ? "," : ""}
                </span>
              ) : null}
              {km !== null ? <OdometerDigits value={km} unit="km" /> : null}
            </div>
          ) : null}
        </>
      );
    }
    case "rejected":
      return (
        <>
          <StatusChip status="rejected" />
          <p className="mt-3 text-body-lg">The office rejected this report. Record it again.</p>
        </>
      );
    case "failed":
      return !report || report.rerecord ? (
        <p className="text-body-lg">This report couldn&rsquo;t be processed. Record it again and the office will get it.</p>
      ) : (
        <p className="text-body-lg">Something went wrong on our side. Your recording is safe — we&rsquo;re retrying.</p>
      );
  }
}
