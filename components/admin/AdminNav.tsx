"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const NAV_ITEMS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Today" },
  { href: "/dashboard/reports", label: "Reports" },
  { href: "/dashboard/alerts", label: "Alerts" },
  { href: "/dashboard/digest", label: "Digest" },
  { href: "/dashboard/vehicles", label: "Vehicles" },
  { href: "/dashboard/people", label: "People" },
  { href: "/dashboard/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type AdminNavProps = {
  orgName: string;
  openAlerts: number;
  /** The sign-out form, rendered by the server layout. */
  signOut: ReactNode;
};

/**
 * Text labels always, never icon-only (design-brief §3). On a desktop it is the left rail
 * with Settings at the bottom; below 900px it is a top bar that scrolls sideways.
 */
export function AdminNav({ orgName, openAlerts, signOut }: AdminNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard"
      className="flex shrink-0 flex-col border-b border-line px-4 pt-4 pb-2 min-[900px]:min-h-dvh min-[900px]:w-60 min-[900px]:border-r min-[900px]:border-b-0 min-[900px]:px-5 min-[900px]:py-6"
    >
      <p className="truncate font-display text-heading font-bold">{orgName}</p>
      <ul className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 text-body-lg min-[900px]:mx-0 min-[900px]:mt-7 min-[900px]:flex-1 min-[900px]:flex-col min-[900px]:overflow-visible min-[900px]:px-0">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const badge = item.label === "Alerts" && openAlerts > 0 ? openAlerts : null;
          return (
            <li key={item.href} className={cn(item.label === "Settings" && "min-[900px]:mt-auto")}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-control px-3 whitespace-nowrap",
                  active ? "bg-ink/6 text-ink" : "text-steel hover:text-ink",
                )}
              >
                {item.label}
                {badge !== null ? (
                  <span className="font-display font-semibold text-flag tabular">
                    {badge}
                    <span className="sr-only"> open</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden min-[900px]:mt-3 min-[900px]:block">{signOut}</div>
    </nav>
  );
}
