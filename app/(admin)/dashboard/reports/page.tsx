import type { Metadata } from "next";
import { PageHeader, Tabs } from "@/components/admin/PageHeader";
import { ReportTable } from "@/components/admin/ReportTable";
import { flagsFromValidation, routeOf, type ReportRowData } from "@/lib/admin/board";
import { requireStaff } from "@/lib/auth";
import type { ReportStatus } from "@/lib/report-status";

export const metadata: Metadata = { title: "Reports" };

type SearchParams = Promise<{ status?: string }>;

const FILTERS: ReadonlyArray<{ key: string; label: string; statuses: ReportStatus[] | null }> = [
  { key: "", label: "All", statuses: null },
  { key: "ready", label: "Ready to review", statuses: ["ready"] },
  { key: "needs_answer", label: "Needs answer", statuses: ["needs_clarification"] },
  { key: "approved", label: "Approved", statuses: ["reviewed"] },
  { key: "rejected", label: "Rejected", statuses: ["rejected"] },
  { key: "processing", label: "Processing", statuses: ["queued", "transcribing", "extracting", "validating"] },
  { key: "failed", label: "Not processed", statuses: ["failed"] },
];

const LIMIT = 200;

/** The rail's "Reports": every report, newest day first, with a status filter. */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { status } = await searchParams;
  const { supabase, organization } = await requireStaff();
  const filter = FILTERS.find((entry) => entry.key === (status ?? "")) ?? FILTERS[0];

  let query = supabase
    .from("reports")
    .select(
      "id, report_date, status, submitted_at, origin, destination, distance_km, fuel_liters, validation, vehicles(plate_number, label), profiles!reports_user_id_fkey(full_name)",
    )
    .eq("org_id", organization.id)
    .order("report_date", { ascending: false })
    .order("submitted_at", { ascending: false })
    .limit(LIMIT);
  if (filter.statuses) query = query.in("status", filter.statuses);
  const { data: reports, error } = await query;
  if (error) throw new Error(`Could not read reports: ${error.message}`);

  const ids = (reports ?? []).map((report) => report.id);
  const openAlerts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: alerts } = await supabase.from("alerts").select("report_id").eq("status", "open").in("report_id", ids);
    for (const alert of alerts ?? []) {
      if (alert.report_id) openAlerts.set(alert.report_id, (openAlerts.get(alert.report_id) ?? 0) + 1);
    }
  }

  const rows: ReportRowData[] = (reports ?? []).map((report) => ({
    key: report.id,
    href: `/dashboard/reports/${report.id}`,
    date: report.report_date,
    plate: report.vehicles?.plate_number ?? "—",
    label: report.vehicles?.label ?? null,
    driver: report.profiles?.full_name ?? null,
    status: report.status,
    openAlerts: openAlerts.get(report.id) ?? 0,
    route: routeOf(report.origin, report.destination),
    km: report.distance_km,
    liters: report.fuel_liters,
    flags: flagsFromValidation(report.validation),
  }));

  return (
    <>
      <PageHeader title="Reports" />
      <div className="mt-2 overflow-x-auto">
        <Tabs
          label="Status"
          items={FILTERS.map((entry) => ({
            href: entry.key ? `/dashboard/reports?status=${entry.key}` : "/dashboard/reports",
            label: entry.label,
            active: entry.key === filter.key,
          }))}
        />
      </div>
      <ReportTable
        rows={rows}
        showDate
        empty={
          <p className="text-body-lg">
            {filter.statuses ? "No reports with this status." : "No reports yet. They appear here as drivers send them."}
          </p>
        }
      />
      {rows.length === LIMIT ? <p className="mt-4 text-caption text-steel">Showing the newest {LIMIT}. Export CSV for the full history.</p> : null}
    </>
  );
}
