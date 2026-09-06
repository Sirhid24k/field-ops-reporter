import Link from "next/link";
import type { ReactNode } from "react";
import { OfflineBanner } from "./OfflineBanner";

/** One column, 16px gutters, 480px max (design-brief §3). The primary action sits in BottomZone. */
export function Screen({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pt-6">{children}</main>;
}

/** The bottom 96px: one 56px action pinned where the thumb is, above the safe area. */
export function BottomZone({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto bg-paper px-4 pt-5 pb-[max(20px,env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}

/** F2 header: org name left, first name right, with the offline banner under it. */
export function FieldHeader({ orgName, firstName }: { orgName: string; firstName: string }) {
  return (
    <>
      <header className="flex items-baseline justify-between text-caption text-steel">
        <span>{orgName}</span>
        <span>{firstName}</span>
      </header>
      <OfflineBanner />
    </>
  );
}

/** F3–F5 header: the "‹ Today" back link, the offline banner, then the screen title. */
export function BackHeader({ title }: { title: string }) {
  return (
    <>
      <header>
        <Link
          href="/app"
          aria-label="Back to Today"
          className="-ml-2 inline-flex min-h-12 items-center gap-1.5 px-2 text-body-lg"
        >
          <span aria-hidden="true" className="font-display text-heading leading-none">
            ‹
          </span>
          Today
        </Link>
      </header>
      <OfflineBanner />
      <h1 className="mt-1 font-display text-title font-bold">{title}</h1>
    </>
  );
}
