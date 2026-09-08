import Link from "next/link";
import type { ReactNode } from "react";
import { StatusChip } from "@/components/ui";
import { chipForRow, rowSummaryLine, type ReportRowData } from "@/lib/admin/board";
import { cn } from "@/lib/cn";
import { formatDayShort } from "@/lib/dates";
import { formatGrouped, shortName } from "@/lib/format";
import { LinkRow } from "./LinkRow";

const km = (value: number) => formatGrouped(value);
const litres = (value: number) => formatGrouped(value, { maximumFractionDigits: 1 });

function Chip({ row }: { row: ReportRowData }) {
  const chip = chipForRow(row);
  if (chip.kind === "text") return <span className="font-display text-body font-semibold text-flag">{chip.label}</span>;
  return <StatusChip status={chip.status} surface="admin" count={chip.count} />;
}

/** A number cell: right-aligned tabular digits; a figure that failed a check in flag with a "!" glyph. */
function Figure({ value, flagged, format }: { value: number | null; flagged: boolean; format: (value: number) => string }) {
  if (value === null) return <span className="text-steel">—</span>;
  return (
    <span className={cn("font-display text-body-lg font-semibold tabular", flagged && "text-flag")}>
      {format(value)}
      {flagged ? (
        <>
          <span aria-hidden="true"> !</span>
          <span className="sr-only">, failed a check</span>
        </>
      ) : null}
    </span>
  );
}

export type ReportTableProps = {
  rows: ReportRowData[];
  /** The Reports list shows the date; the board is one day. */
  showDate?: boolean;
  empty?: ReactNode;
};

/**
 * The board table (wireframe 1j): Vehicle / Driver / Status / Route / km / L, 48px rows,
 * row click opens the report. Below 900px the same rows stack as plate + chip + one line
 * (wireframe 1p). Both are rendered; only one is shown, so assistive tech sees one.
 */
export function ReportTable({ rows, showDate = false, empty }: ReportTableProps) {
  if (rows.length === 0) return <div className="mt-8">{empty}</div>;

  const head = "px-3 py-2 text-left text-caption font-normal text-steel first:pl-2 last:pr-2";
  const cell = "px-3 first:pl-2 last:pr-2";

  return (
    <>
      <table className="mt-6 hidden w-full border-collapse min-[900px]:table">
        <thead>
          <tr className="border-b border-line">
            {showDate ? <th className={head}>Date</th> : null}
            <th className={head}>Vehicle</th>
            <th className={head}>Driver</th>
            <th className={head}>Status</th>
            <th className={head}>Route</th>
            <th className={cn(head, "text-right")}>km</th>
            <th className={cn(head, "text-right")}>L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = (
              <>
                {showDate ? <td className={cn(cell, "font-display text-body-lg font-semibold tabular")}>{formatDayShort(row.date)}</td> : null}
                <td className={cell}>
                  {row.href ? (
                    <Link href={row.href} className="font-display text-body-lg font-bold tabular" title={row.label ?? undefined}>
                      {row.plate}
                    </Link>
                  ) : (
                    <span className="font-display text-body-lg font-bold tabular" title={row.label ?? undefined}>
                      {row.plate}
                    </span>
                  )}
                </td>
                <td className={cell}>{row.driver ? shortName(row.driver) : <span className="text-steel">—</span>}</td>
                <td className={cell}>
                  <Chip row={row} />
                </td>
                <td className={cell}>{row.route ?? <span className="text-steel">—</span>}</td>
                <td className={cn(cell, "text-right")}>
                  <Figure value={row.km} flagged={row.flags.km} format={km} />
                </td>
                <td className={cn(cell, "text-right")}>
                  <Figure value={row.liters} flagged={row.flags.liters} format={litres} />
                </td>
              </>
            );
            return row.href ? (
              <LinkRow key={row.key} href={row.href} className="h-12 border-b border-line">
                {cells}
              </LinkRow>
            ) : (
              <tr key={row.key} className="h-12 border-b border-line">
                {cells}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="mt-5 min-[900px]:hidden">
        {rows.map((row) => {
          const line = rowSummaryLine(row, km);
          const body = (
            <>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {showDate ? <span className="text-caption text-steel tabular">{formatDayShort(row.date)}</span> : null}
                <span className="font-display text-body-lg font-bold tabular">{row.plate}</span>
                <Chip row={row} />
              </span>
              {line ? <span className={cn("mt-0.5 block text-body text-steel", (row.flags.km || row.flags.liters) && "text-flag")}>{line}</span> : null}
            </>
          );
          return (
            <li key={row.key} className="border-b border-line">
              {row.href ? (
                <Link href={row.href} className="block min-h-14 py-3 hover:bg-ink/6">
                  {body}
                </Link>
              ) : (
                <div className="min-h-14 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
