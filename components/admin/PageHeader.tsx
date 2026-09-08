import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The first row of every admin page: the screen title, optionally a date pager or tabs
 * beside it, and the page's actions pushed to the right (wireframe 1j: "Today ‹ Tue 2 Sep ›
 * … Export CSV"). Wraps onto two lines on a phone.
 */
export function PageHeader({
  title,
  beside,
  actions,
  className,
}: {
  title: string;
  beside?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-6 gap-y-3", className)}>
      <h1 className="font-display text-title font-bold">{title}</h1>
      {beside}
      {actions ? <div className="flex flex-wrap items-center gap-3 min-[900px]:ml-auto">{actions}</div> : null}
    </div>
  );
}

/** Text tabs (Open / Acknowledged, Vehicles / People): the active one in ink with a 2px underline. */
export function Tabs({ label, items }: { label: string; items: ReadonlyArray<{ href: string; label: string; active: boolean; count?: number }> }) {
  return (
    <nav aria-label={label} className="flex gap-5 font-display text-body-lg font-semibold">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 border-b-2",
            item.active ? "border-ink text-ink" : "border-transparent text-steel hover:text-ink",
          )}
        >
          {item.label}
          {item.count !== undefined ? <span className="tabular">{item.count}</span> : null}
        </a>
      ))}
    </nav>
  );
}
