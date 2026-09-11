import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { BackHeader, Screen } from "@/components/field/Frame";
import { Button, StatusChip } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { dateInZone, formatDayShort, formatMonthHeading, monthKey } from "@/lib/dates";
import { formatGrouped } from "@/lib/format";
import { chipForStatus, isMoving } from "@/lib/report-status";

export const metadata: Metadata = { title: "My reports" };

/** F5 — My reports: date-grouped list, newest first. RLS limits the rows to this driver's own. */
export default async function ReportsPage() {
  const { supabase, user, organization } = await requireMember();
  const todayIso = dateInZone(new Date(), organization.timezone);

  const { data: reports } = await supabase
    .from("reports")
    .select("id, report_date, submitted_at, status, origin, destination, distance_km")
    .eq("user_id", user.id)
    .order("report_date", { ascending: false })
    .order("submitted_at", { ascending: false })
    .limit(200);

  const groups: Array<{ key: string; heading: string; rows: NonNullable<typeof reports> }> = [];
  for (const report of reports ?? []) {
    const key = monthKey(report.report_date);
    const group = groups.at(-1);
    if (group && group.key === key) group.rows.push(report);
    else groups.push({ key, heading: formatMonthHeading(report.report_date, todayIso), rows: [report] });
  }

  return (
    <Screen>
      <BackHeader title="My reports" />

      {groups.length === 0 ? (
        <p className="mt-6 text-body-lg text-steel">No reports yet. Your first one shows up here.</p>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="mt-6">
            <h2 className="font-display text-heading font-bold">{group.heading}</h2>
            <ul className="mt-2">
              {group.rows.map((report) => {
                const chip = chipForStatus(report.status);
                const route =
                  report.origin && report.destination
                    ? `${report.origin} → ${report.destination}`
                    : isMoving(report.status)
                      ? "Processing"
                      : "—";
                return (
                  <li key={report.id}>
                    <Link
                      // a report waiting for the driver's answer opens the answer screen, not the read-only detail
                      href={report.status === "needs_clarification" ? `/app/clarify/${report.id}` : `/app/reports/${report.id}`}
                      className="flex min-h-14 items-center justify-between gap-3 border-b border-line py-2"
                    >
                      <span className="min-w-0">
                        <span className="block font-display text-body-lg font-semibold">{formatDayShort(report.report_date)}</span>
                        <span className="block truncate text-body text-steel">{route}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="font-display text-body-lg font-semibold tabular">
                          {report.distance_km !== null ? `${formatGrouped(report.distance_km)} km` : "—"}
                        </span>
                        {chip ? <StatusChip status={chip} /> : <span className="text-caption text-flag">Not processed</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <form action={signOut} className="mt-12 mb-8">
        <Button type="submit" variant="text" className="text-steel">
          Sign out
        </Button>
      </form>
    </Screen>
  );
}
