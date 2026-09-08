"use client";

import { useState, useTransition } from "react";
import { generateDigestNow } from "@/app/(admin)/dashboard/actions";
import { Button } from "@/components/ui";

/**
 * Regenerate (a digest exists) or Generate now (none yet): the session-3 lib writes the
 * digest for the day and the page re-reads it. The same verb from button to state:
 * "Regenerate" → "Regenerating…".
 */
export function DigestActions({ date, hasDigest, variant = "secondary" }: { date: string; hasDigest: boolean; variant?: "primary" | "secondary" }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await generateDigestNow({ date });
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <Button variant={variant} onClick={run} loading={pending} loadingLabel={hasDigest ? "Regenerating…" : "Generating…"}>
        {hasDigest ? "Regenerate" : "Generate now"}
      </Button>
      {error ? (
        <span role="alert" className="text-caption text-flag">
          {error}
        </span>
      ) : null}
    </span>
  );
}
