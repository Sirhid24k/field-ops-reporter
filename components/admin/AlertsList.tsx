"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acknowledgeAlert } from "@/app/(admin)/dashboard/alerts/actions";
import { Button } from "@/components/ui";
import { severityEdgeClass, severityLabel, type Severity } from "@/lib/admin/alerts";
import { cn } from "@/lib/cn";

export type AlertRowData = {
  id: string;
  typeLabel: string;
  severity: Severity;
  plate: string | null;
  driver: string | null;
  message: string;
  /** "6:48 pm" or "Tue 2 Sep, 6:48 pm", in the org's timezone. */
  time: string;
  /** The report, or the board for the day of a missing-report alert. */
  href: string;
  /** "Acknowledged by Amaka Obi, 7:10 pm" on the Acknowledged tab; null while open. */
  acknowledgedLabel: string | null;
};

type Kept = { row: AlertRowData; label: string | null };

/**
 * The alert rows (wireframe 1m). Acknowledge runs as a server action; the row then reads
 * "Acknowledged by you, 7:10 pm" and stays where it is until the next load, even though the
 * server has already moved it to the other tab (the rail count drops straight away).
 */
export function AlertsList({ rows }: { rows: AlertRowData[] }) {
  const [kept, setKept] = useState<Map<string, Kept>>(() => new Map());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const ids = new Set(rows.map((row) => row.id));
  const visible: AlertRowData[] = [...rows];
  for (const entry of kept.values()) if (!ids.has(entry.row.id)) visible.push(entry.row);

  function acknowledge(row: AlertRowData) {
    setErrors((previous) => ({ ...previous, [row.id]: "" }));
    setKept((previous) => new Map(previous).set(row.id, { row, label: null }));
    startTransition(async () => {
      const result = await acknowledgeAlert({ alertId: row.id });
      setKept((previous) => {
        const next = new Map(previous);
        if (result.ok) next.set(row.id, { row, label: result.label });
        else next.delete(row.id);
        return next;
      });
      if (!result.ok) setErrors((previous) => ({ ...previous, [row.id]: result.message }));
    });
  }

  return (
    <ul className="mt-4">
      {visible.map((row) => {
        const local = kept.get(row.id);
        const label = row.acknowledgedLabel ?? local?.label ?? null;
        const pending = local !== undefined && local.label === null;
        return (
          <li key={row.id} className={cn("flex flex-col gap-3 border-b border-l-4 border-b-line py-4 pl-4 min-[900px]:flex-row min-[900px]:items-start", severityEdgeClass(row.severity))}>
            <span className="sr-only">{severityLabel(row.severity)}</span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-heading font-bold">
                <Link href={row.href} className="hover:underline hover:underline-offset-4">
                  {row.typeLabel}
                </Link>
              </p>
              <p className="mt-0.5 text-body text-steel">
                {row.plate ? <span className="font-display font-semibold tabular">{row.plate}</span> : null}
                {row.plate && row.driver ? ", " : null}
                {row.driver}
              </p>
              <p className="mt-1.5 max-w-[70ch] text-body">{row.message}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 min-[900px]:flex-col min-[900px]:items-end min-[900px]:pr-2">
              <span className="font-display text-body font-semibold text-steel tabular">{row.time}</span>
              {label ? (
                <span className="text-body text-steel">{label}</span>
              ) : (
                <Button variant="text" onClick={() => acknowledge(row)} loading={pending} loadingLabel="Acknowledging…" className="-mr-2 min-h-10 text-body">
                  Acknowledge
                </Button>
              )}
              {errors[row.id] ? (
                <span role="alert" className="text-caption text-flag">
                  {errors[row.id]}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
