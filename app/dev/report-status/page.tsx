import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Input, StatusChip } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { formatClock, formatDayShort } from "@/lib/dates";
import { devToolsEnabled } from "@/lib/dev-tools";
import { chipForStatus } from "@/lib/report-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { Constants } from "@/lib/supabase/types";
import { askQuestion, clearSample, deleteReport, fillSample, setStatus } from "./actions";

export const metadata: Metadata = {
  title: "Report status (dev)",
  robots: { index: false, follow: false },
};

const STATUSES = Constants.public.Enums.report_status;

/**
 * Dev-only: flip any report in your organisation through the statuses the pipeline will
 * produce in session 3, so every Today variant can be checked now. Not linked anywhere;
 * returns 404 in production unless DEV_TOOLS=true.
 */
export default async function ReportStatusDevPage() {
  if (!devToolsEnabled()) notFound();
  const { profile, organization } = await requireMember();

  const admin = createAdminClient();
  const { data: reports } = await admin
    .from("reports")
    .select("id, report_date, submitted_at, status, source, origin, destination, distance_km, audio_path, vehicles(plate_number), profiles!reports_user_id_fkey(full_name)")
    .eq("org_id", profile.org_id)
    .order("submitted_at", { ascending: false })
    .limit(12);

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-10">
      <p className="text-caption text-steel">{organization.name}, developer tools</p>
      <h1 className="mt-2 font-display text-title font-bold">Report status</h1>
      <p className="mt-2 max-w-[70ch] text-body-lg text-steel">
        Flip a report through the statuses the pipeline will set in session 3, then check{" "}
        <Link href="/app" className="text-ink underline underline-offset-4">
          Today
        </Link>
        . Uses the service role; only reports in your organisation are listed.
      </p>

      {!reports || reports.length === 0 ? (
        <p className="mt-8 text-body-lg">No reports in this organisation yet. Send one from /app/new first.</p>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {reports.map((report) => {
            const chip = chipForStatus(report.status);
            return (
              <li key={report.id} className="py-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-heading font-bold">{formatDayShort(report.report_date)}</span>
                  <span className="font-display text-body-lg font-semibold tabular">{report.vehicles?.plate_number}</span>
                  <span className="text-body text-steel">{report.profiles?.full_name}</span>
                  {chip ? <StatusChip status={chip} surface="admin" /> : <span className="text-caption text-flag">failed</span>}
                </div>
                <p className="mt-1 text-caption text-steel tabular">
                  {report.status}, {report.source}, sent {formatClock(report.submitted_at, organization.timezone)}
                  {report.audio_path ? `, audio ${report.audio_path.split("/").pop()}` : ", no audio"}
                  {report.origin && report.destination ? `, ${report.origin} → ${report.destination}` : ""}
                  {report.distance_km !== null ? `, ${report.distance_km} km` : ""}
                </p>
                <p className="mt-1 text-caption text-steel">{report.id}</p>

                <form action={setStatus} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="reportId" value={report.id} />
                  {STATUSES.map((status) => (
                    <Button
                      key={status}
                      type="submit"
                      name="status"
                      value={status}
                      variant={status === report.status ? "primary" : "secondary"}
                      className="min-h-10 px-3 text-body"
                    >
                      {status}
                    </Button>
                  ))}
                </form>

                <form action={askQuestion} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="reportId" value={report.id} />
                  <Input
                    name="question"
                    label="Ask a question (sets needs_clarification)"
                    placeholder="What was the odometer reading when you stopped?"
                    className="min-w-[280px] flex-1"
                  />
                  <Button type="submit" variant="secondary">
                    Ask
                  </Button>
                </form>

                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={fillSample}>
                    <input type="hidden" name="reportId" value={report.id} />
                    <Button type="submit" variant="secondary" className="min-h-10 px-3 text-body">
                      Fill sample fields (Kaduna → Kano, 214 km)
                    </Button>
                  </form>
                  <form action={clearSample}>
                    <input type="hidden" name="reportId" value={report.id} />
                    <Button type="submit" variant="text" className="min-h-10 text-body">
                      Clear fields
                    </Button>
                  </form>
                  <form action={deleteReport}>
                    <input type="hidden" name="reportId" value={report.id} />
                    <Button type="submit" variant="destructive" className="min-h-10 px-3 text-body">
                      Delete report
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
