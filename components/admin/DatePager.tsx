import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatDayShort, shiftDate } from "@/lib/dates";

const arrow = "inline-flex size-11 shrink-0 items-center justify-center rounded-control font-display text-heading leading-none";

/**
 * "‹ Tue 2 Sep ›" (wireframe 1j). Days are links so the browser's back button works and
 * the URL can be shared; the forward arrow stops at today.
 */
export function DatePager({ date, today, basePath }: { date: string; today: string; basePath: string }) {
  const previous = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const atToday = date >= today;

  return (
    <nav aria-label="Day" className="flex items-center gap-1">
      <Link href={`${basePath}?date=${previous}`} aria-label={`Previous day, ${formatDayShort(previous)}`} className={cn(arrow, "hover:bg-ink/6")}>
        ‹
      </Link>
      <span className="min-w-[9ch] text-center font-display text-body-lg font-semibold tabular">{formatDayShort(date)}</span>
      {atToday ? (
        <span aria-hidden="true" className={cn(arrow, "text-steel")}>
          ›
        </span>
      ) : (
        <Link href={next >= today ? basePath : `${basePath}?date=${next}`} aria-label={`Next day, ${formatDayShort(next)}`} className={cn(arrow, "hover:bg-ink/6")}>
          ›
        </Link>
      )}
      {date !== today ? (
        <Link href={basePath} className="ml-2 text-body text-steel underline decoration-1 underline-offset-4 hover:text-ink">
          Today
        </Link>
      ) : null}
    </nav>
  );
}
