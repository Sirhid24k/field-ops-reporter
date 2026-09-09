"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button, buttonClassName } from "@/components/ui";

/** A dashboard page that failed to load; the rail stays, so nothing is a dead end. */
export default function DashboardErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <PageHeader title="Something went wrong" />
      <p className="mt-3 max-w-[60ch] text-body-lg">This page couldn&rsquo;t load. Nothing has been changed or lost.</p>
      <p className="mt-2 max-w-[60ch] text-body text-steel">Try again. If it keeps happening, sign out and back in.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard" className={buttonClassName({ variant: "secondary" })}>
          Today
        </Link>
      </div>
      {error.digest ? <p className="mt-8 text-caption text-steel tabular">Reference {error.digest}</p> : null}
    </>
  );
}
