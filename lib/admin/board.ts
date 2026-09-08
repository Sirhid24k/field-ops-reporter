import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChipStatus } from "@/components/ui";
import { utcRangeForLocalDay } from "@/lib/pipeline/digest";
import { chipForStatus, isMoving, type ReportStatus } from "@/lib/report-status";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * The Today board (A1) and the Reports list share one row shape. The pure parts (which
 * report represents a vehicle, the sort, which figure failed a check, the chip) are here
 * and unit-tested; `loadBoard` does the reads as the signed-in user, so RLS scopes them.
 */

export type ReportRowData = {
  key: string;
  /** The report detail, or null when the vehicle has no report that day. */
  href: string | null;
  date: string;
  plate: string;
  label: string | null;
  driver: string | null;
  status: ReportStatus | null;
  openAlerts: number;
  route: string | null;
  km: number | null;
  liters: number | null;
  /** Figures that failed a check render in flag with a "!" glyph. */
  flags: { km: boolean; liters: boolean };
};

export type BoardCounts = { reported: number; notReported: number; needsAnswer: number; alerts: number };

/** Vehicles with a report in one of these count as "reported" (same definition as the digest). */
export const REPORTED_STATUSES: ReadonlySet<ReportStatus> = new Set(["ready", "reviewed", "needs_clarification"]);

// ---------------------------------------------------------------------------
// pure
// ---------------------------------------------------------------------------

type ValidationEntry = { rule?: unknown; passed?: unknown; message?: unknown };

/** Which board figures failed a check, from the stored `validation` array. */
export function flagsFromValidation(validation: Json | null): ReportRowData["flags"] {
  const flags = { km: false, liters: false };
  if (!Array.isArray(validation)) return flags;
  for (const raw of validation) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as ValidationEntry;
    if (entry.passed !== false) continue;
    const message = typeof entry.message === "string" ? entry.message : "";
    if (entry.rule === "odometer_monotonic") flags.km = true;
    else if (entry.rule === "fuel_efficiency") flags.liters = true;
    else if (entry.rule === "sane_values") {
      if (/\bFuel(?! cost)/.test(message)) flags.liters = true;
      if (/\bOdometer/.test(message)) flags.km = true;
    }
  }
  return flags;
}

/** Board order: alerts, needs answer, not reported, then the rest; plates alphabetical inside a group. */
export function rowRank(row: Pick<ReportRowData, "status" | "openAlerts">): number {
  if (row.openAlerts > 0) return 0;
  if (row.status === "needs_clarification") return 1;
  if (row.status === null) return 2;
  return 3;
}

export function sortRows<T extends Pick<ReportRowData, "status" | "openAlerts" | "plate">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => rowRank(a) - rowRank(b) || a.plate.localeCompare(b.plate));
}

/**
 * When a vehicle has more than one report on a day, the row shows the one that needs the
 * most attention: open alerts first, then an open question, then the newest.
 */
export function pickReport<T extends { status: ReportStatus; openAlerts: number; submitted_at: string }>(reports: T[]): T | null {
  if (reports.length === 0) return null;
  return [...reports].sort(
    (a, b) =>
      b.openAlerts - a.openAlerts ||
      Number(b.status === "needs_clarification") - Number(a.status === "needs_clarification") ||
      b.submitted_at.localeCompare(a.submitted_at),
  )[0];
}

export type RowChip = { kind: "chip"; status: ChipStatus; count?: number } | { kind: "text"; label: string };

/** The status cell: an alert count beats the status; a queued report reads "Processing" here. */
export function chipForRow(row: Pick<ReportRowData, "status" | "openAlerts">): RowChip {
  if (row.openAlerts > 0) return { kind: "chip", status: "alert", count: row.openAlerts };
  if (row.status === null) return { kind: "chip", status: "not_reported" };
  if (row.status === "failed") return { kind: "text", label: "Not processed" };
  if (isMoving(row.status)) return { kind: "chip", status: "processing" };
  const chip = chipForStatus(row.status);
  return chip ? { kind: "chip", status: chip } : { kind: "text", label: "Not processed" };
}

export function routeOf(origin: string | null, destination: string | null): string | null {
  return origin && destination ? `${origin} → ${destination}` : null;
}

/** The one line under the plate on a phone: "Yusuf, Lokoja → Minna" / "Musa, 214 km" / "Sani". */
export function rowSummaryLine(row: Pick<ReportRowData, "driver" | "route" | "km">, formatKm: (km: number) => string): string {
  const parts = [row.driver?.split(/\s+/)[0] ?? null, row.route ?? (row.km !== null ? `${formatKm(row.km)} km` : null)].filter(Boolean);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

type Client = SupabaseClient<Database>;

export type Board = { rows: ReportRowData[]; counts: BoardCounts; vehicles: number };

/** One row per active vehicle for `date`, left-joined to that day's reports; counts for the strip. */
export async function loadBoard(
  supabase: Client,
  org: { id: string; timezone: string },
  date: string,
): Promise<Board> {
  const [vehiclesQuery, reportsQuery] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, label, profiles!vehicles_default_driver_id_fkey(full_name)")
      .eq("org_id", org.id)
      .eq("active", true)
      .order("plate_number"),
    supabase
      .from("reports")
      .select(
        "id, vehicle_id, status, submitted_at, origin, destination, distance_km, fuel_liters, validation, profiles!reports_user_id_fkey(full_name)",
      )
      .eq("org_id", org.id)
      .eq("report_date", date),
  ]);
  if (vehiclesQuery.error) throw new Error(`Could not read vehicles: ${vehiclesQuery.error.message}`);
  if (reportsQuery.error) throw new Error(`Could not read reports: ${reportsQuery.error.message}`);
  const vehicles = vehiclesQuery.data ?? [];
  const reports = reportsQuery.data ?? [];

  const range = utcRangeForLocalDay(date, org.timezone);
  const reportIds = reports.map((report) => report.id);
  const [alertsQuery, missingQuery] = await Promise.all([
    reportIds.length > 0
      ? supabase.from("alerts").select("report_id").eq("status", "open").in("report_id", reportIds)
      : Promise.resolve({ data: [] as Array<{ report_id: string | null }>, error: null }),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("status", "open")
      .eq("type", "missing_report")
      .gte("created_at", range.start)
      .lt("created_at", range.end),
  ]);
  if (alertsQuery.error) throw new Error(`Could not read alerts: ${alertsQuery.error.message}`);
  if (missingQuery.error) throw new Error(`Could not read alerts: ${missingQuery.error.message}`);

  const openAlerts = new Map<string, number>();
  for (const alert of alertsQuery.data ?? []) {
    if (alert.report_id) openAlerts.set(alert.report_id, (openAlerts.get(alert.report_id) ?? 0) + 1);
  }

  const byVehicle = new Map<string, Array<(typeof reports)[number] & { openAlerts: number }>>();
  for (const report of reports) {
    const list = byVehicle.get(report.vehicle_id) ?? [];
    list.push({ ...report, openAlerts: openAlerts.get(report.id) ?? 0 });
    byVehicle.set(report.vehicle_id, list);
  }

  const rows: ReportRowData[] = vehicles.map((vehicle) => {
    const report = pickReport(byVehicle.get(vehicle.id) ?? []);
    return {
      key: vehicle.id,
      href: report ? `/dashboard/reports/${report.id}` : null,
      date,
      plate: vehicle.plate_number,
      label: vehicle.label,
      driver: report?.profiles?.full_name ?? vehicle.profiles?.full_name ?? null,
      status: report?.status ?? null,
      openAlerts: report?.openAlerts ?? 0,
      route: report ? routeOf(report.origin, report.destination) : null,
      km: report?.distance_km ?? null,
      liters: report?.fuel_liters ?? null,
      flags: flagsFromValidation(report?.validation ?? null),
    };
  });

  const reportedVehicles = new Set(reports.filter((report) => REPORTED_STATUSES.has(report.status)).map((report) => report.vehicle_id));
  const counts: BoardCounts = {
    reported: vehicles.filter((vehicle) => reportedVehicles.has(vehicle.id)).length,
    notReported: vehicles.filter((vehicle) => !reportedVehicles.has(vehicle.id)).length,
    needsAnswer: reports.filter((report) => report.status === "needs_clarification").length,
    alerts: Array.from(openAlerts.values()).reduce((sum, n) => sum + n, 0) + (missingQuery.count ?? 0),
  };

  return { rows: sortRows(rows), counts, vehicles: vehicles.length };
}
