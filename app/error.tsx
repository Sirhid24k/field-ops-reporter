"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClassName } from "@/components/ui";

/**
 * The root error boundary (sign-in, onboarding, invites, and anything without its own):
 * what happened, what happens next, and a way out (design-brief §7).
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 py-12">
      <p className="text-caption text-steel">Field Ops Reporter</p>
      <h1 className="mt-6 font-display text-title font-bold">Something went wrong</h1>
      <p className="mt-3 text-body-lg">This page couldn&rsquo;t load. Nothing you sent has been lost.</p>
      <p className="mt-2 text-body text-steel">Try again. If it keeps happening, sign out and back in.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={buttonClassName({ variant: "secondary" })}>
          Go to the start
        </Link>
      </div>
      {error.digest ? <p className="mt-8 text-caption text-steel tabular">Reference {error.digest}</p> : null}
    </main>
  );
}
