"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A table row that opens `href` when clicked anywhere on it. Clicks on a control inside the
 * row (a link, a button, a toggle) are left to that control. The row's first cell carries a
 * real link, so keyboard and screen-reader users get the same destination.
 */
export function LinkRow({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={cn("cursor-pointer hover:bg-ink/6", className)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
        if (window.getSelection()?.toString()) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
