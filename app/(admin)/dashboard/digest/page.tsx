import type { Metadata } from "next";
import { CountStrip, padCount } from "@/components/admin/CountStrip";
import { DatePager } from "@/components/admin/DatePager";
import { DigestActions } from "@/components/admin/DigestActions";
import { Markdown } from "@/components/admin/Markdown";
import { PageHeader } from "@/components/admin/PageHeader";
import { buttonClassName } from "@/components/ui";
import { asObject } from "@/lib/admin/report-fields";
import { requireStaff } from "@/lib/auth";
import { formatClock, formatDayShort, isIsoDate } from "@/lib/dates";
import { formatTime12h } from "@/lib/format";
import { whatsappShareUrl } from "@/lib/invites";
import { markdownToPlainText } from "@/lib/markdown";
import { cutoffMinutes, localClock } from "@/lib/pipeline/digest";

export const metadata: Metadata = { title: "Digest" };

type SearchParams = Promise<{ date?: string }>;

function statNumber(stats: Record<string, unknown> | null, key: string): number {
  const value = stats?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A5 Digest: date pager, the stats strip, the digest as rendered text; Regenerate, Share on WhatsApp, Export CSV. */
export default async function DigestPage({ searchParams }: { searchParams: SearchParams }) {
  const { date: dateParam } = await searchParams;
  const { supabase, organization } = await requireStaff();
  const clock = localClock(organization.timezone, new Date());
  const today = clock.date;
  const date = isIsoDate(dateParam) && dateParam < today ? dateParam : today;
  const beforeCutoff = date === today && clock.minutes < cutoffMinutes(organization.report_cutoff_time);
  const cutoffLabel = formatTime12h(organization.report_cutoff_time);

  const { data: digest, error } = await supabase
    .from("daily_digests")
    .select("content_md, stats, generated_at")
    .eq("org_id", organization.id)
    .eq("digest_date", date)
    .maybeSingle();
  if (error) throw new Error(`Could not read the digest: ${error.message}`);

  const stats = digest ? asObject(digest.stats) : null;
  const exportHref = `/api/export?from=${date}&to=${date}`;

  return (
    <>
      <PageHeader
        title="Digest"
        beside={<DatePager date={date} today={today} basePath="/dashboard/digest" />}
        actions={
          <>
            {digest ? <DigestActions date={date} hasDigest /> : null}
            {digest ? (
              <a href={whatsappShareUrl(markdownToPlainText(digest.content_md))} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "secondary" })}>
                Share on WhatsApp
              </a>
            ) : null}
            <a href={exportHref} className={buttonClassName({ variant: "secondary" })}>
              Export CSV
            </a>
          </>
        }
      />

      {digest ? (
        <>
          <div className="mt-8">
            <CountStrip
              size="hero"
              items={[
                { label: "Reported", value: padCount(statNumber(stats, "reported")) },
                { label: "Missing", value: padCount(statNumber(stats, "missing")) },
                { label: "Alerts", value: padCount(statNumber(stats, "alerts")), tone: "flag" },
                { label: "Total km", value: statNumber(stats, "total_km"), unit: "km", maximumFractionDigits: 1 },
                { label: "Total fuel", value: statNumber(stats, "total_fuel_l"), unit: "L", maximumFractionDigits: 1 },
              ]}
            />
          </div>
          <p className="mt-4 text-caption text-steel">
            Generated {formatClock(digest.generated_at, organization.timezone)}
            {beforeCutoff ? `, before the ${cutoffLabel} cutoff. Regenerate after the cutoff for the full day.` : "."}
          </p>
          <article className="mt-8">
            <Markdown source={digest.content_md} />
          </article>
        </>
      ) : (
        <div className="mt-8 max-w-[60ch]">
          <p className="text-body-lg">
            {beforeCutoff
              ? `Today's digest is generated at ${cutoffLabel}. Generate it now if you want an early view.`
              : `No digest for ${formatDayShort(date)} yet.`}
          </p>
          <div className="mt-5">
            <DigestActions date={date} hasDigest={false} variant="primary" />
          </div>
        </div>
      )}
    </>
  );
}
