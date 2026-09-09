import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/admin/AutoRefresh";
import { CountStrip, padCount } from "@/components/admin/CountStrip";
import { DatePager } from "@/components/admin/DatePager";
import { PageHeader } from "@/components/admin/PageHeader";
import { ReportTable } from "@/components/admin/ReportTable";
import { buttonClassName } from "@/components/ui";
import { loadBoard } from "@/lib/admin/board";
import { requireStaff } from "@/lib/auth";
import { dateInZone, isIsoDate } from "@/lib/dates";
import { isMoving } from "@/lib/report-status";

export const metadata: Metadata = { title: "Today" };

type SearchParams = Promise<{ date?: string }>;

/**
 * A1 Today board: the date pager, the four counts on odometer strips, one row per active
 * vehicle (design-brief §5). Everything is read as the signed-in supervisor under RLS.
 */
export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { date: dateParam } = await searchParams;
  const { supabase, organization } = await requireStaff();
  const today = dateInZone(new Date(), organization.timezone);
  const date = isIsoDate(dateParam) && dateParam < today ? dateParam : today;

  const board = await loadBoard(supabase, organization, date);
  const exportHref = `/api/export?from=${date}&to=${date}`;

  return (
    <>
      <PageHeader
        title="Today"
        beside={<DatePager date={date} today={today} basePath="/dashboard" />}
        actions={
          <a href={exportHref} className={buttonClassName({ variant: "secondary" })}>
            Export CSV
          </a>
        }
      />

      <div className="mt-8">
        <CountStrip
          items={[
            { label: "Reported", value: padCount(board.counts.reported) },
            { label: "Not reported", value: padCount(board.counts.notReported) },
            { label: "Needs answer", value: padCount(board.counts.needsAnswer), tone: "hazard" },
            { label: "Alerts", value: padCount(board.counts.alerts), tone: "flag" },
          ]}
        />
      </div>

      {/* today's board keeps itself current: a phone report lands and moves through the pipeline without a reload */}
      {date === today ? <AutoRefresh everyMs={board.rows.some((row) => row.status !== null && isMoving(row.status)) ? 5_000 : 15_000} /> : null}

      <ReportTable
        rows={board.rows}
        empty={
          <>
            <p className="text-body-lg">No reports yet today. They appear here as drivers send them.</p>
            <Link href="/dashboard/people?invite=1" className={buttonClassName({ variant: "secondary", className: "mt-5" })}>
              Invite a driver
            </Link>
          </>
        }
      />
    </>
  );
}
