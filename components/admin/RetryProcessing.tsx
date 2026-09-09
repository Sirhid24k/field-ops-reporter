"use client";

import { useActionState } from "react";
import { retryProcessing, type ReviewState } from "@/app/(admin)/dashboard/reports/[id]/actions";
import { SubmitButton } from "@/components/ui";

/** The Retry control inside the failed-report notice on the report detail: "Retry" → "Retrying…". */
export function RetryProcessing({ reportId }: { reportId: string }) {
  const [state, action] = useActionState<ReviewState, FormData>(retryProcessing, undefined);

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="reportId" value={reportId} />
      <SubmitButton variant="secondary" loadingLabel="Retrying…">
        Retry
      </SubmitButton>
      {state?.error ? (
        <p role="alert" className="mt-2 text-body text-flag">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
