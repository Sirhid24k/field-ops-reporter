import type { Metadata } from "next";
import { AlertsList, type AlertRowData } from "@/components/admin/AlertsList";
import { PageHeader, Tabs } from "@/components/admin/PageHeader";
import { alertTypeLabel } from "@/lib/admin/alerts";
import { requireStaff } from "@/lib/auth";
import { dateInZone, formatDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Alerts" };

type SearchParams = Promise<{ tab?: string }>;

const LIMIT = 200;

/** A3 Alerts: newest first, Open / Acknowledged, one-click acknowledge, each row linking to its report. */
export default async function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tab } = await searchParams;
  const acknowledged = tab === "acknowledged";
  const { supabase, organization, profile } = await requireStaff();
  const timezone = organization.timezone;
  const todayIso = dateInZone(new Date(), timezone);

  const [{ data: alerts, error }, { count: openCount }] = await Promise.all([
    supabase
      .from("alerts")
      .select(
        "id, type, severity, message, created_at, report_id, acknowledged_at, acknowledged_by, vehicles(plate_number, profiles!vehicles_default_driver_id_fkey(full_name)), reports(profiles!reports_user_id_fkey(full_name)), acknowledger:profiles!alerts_acknowledged_by_fkey(full_name)",
      )
      .eq("org_id", organization.id)
      .eq("status", acknowledged ? "acknowledged" : "open")
      .order(acknowledged ? "acknowledged_at" : "created_at", { ascending: false })
      .limit(LIMIT),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("org_id", organization.id).eq("status", "open"),
  ]);
  if (error) throw new Error(`Could not read alerts: ${error.message}`);

  const rows: AlertRowData[] = (alerts ?? []).map((alert) => {
    const by = alert.acknowledged_by === profile.id ? "you" : (alert.acknowledger?.full_name ?? "a supervisor");
    return {
      id: alert.id,
      typeLabel: alertTypeLabel(alert.type, alert.message),
      severity: alert.severity,
      plate: alert.vehicles?.plate_number ?? null,
      driver: alert.reports?.profiles?.full_name ?? alert.vehicles?.profiles?.full_name ?? null,
      message: alert.message,
      time: formatDateTime(alert.created_at, timezone, todayIso),
      href: alert.report_id ? `/dashboard/reports/${alert.report_id}` : `/dashboard?date=${dateInZone(new Date(alert.created_at), timezone)}`,
      acknowledgedLabel: alert.acknowledged_at ? `Acknowledged by ${by}, ${formatDateTime(alert.acknowledged_at, timezone, todayIso)}` : null,
    };
  });

  return (
    <>
      <PageHeader title="Alerts" />
      <div className="mt-2">
        <Tabs
          label="Alert status"
          items={[
            { href: "/dashboard/alerts", label: "Open", active: !acknowledged, count: openCount ?? 0 },
            { href: "/dashboard/alerts?tab=acknowledged", label: "Acknowledged", active: acknowledged },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <p className="mt-8 max-w-[60ch] text-body-lg">
          {acknowledged ? "Nothing acknowledged yet." : "Nothing open. Alerts appear when a report fails a check or a driver reports an incident."}
        </p>
      ) : (
        <AlertsList rows={rows} />
      )}
    </>
  );
}
