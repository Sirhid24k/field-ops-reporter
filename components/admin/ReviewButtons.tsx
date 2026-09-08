"use client";

import { useActionState } from "react";
import { approveReport, rejectReport, type ReviewState } from "@/app/(admin)/dashboard/reports/[id]/actions";
import { SubmitButton } from "@/components/ui";
import type { ReportStatus } from "@/lib/report-status";

const APPROVABLE: ReadonlySet<ReportStatus> = new Set(["ready", "needs_clarification", "rejected"]);
const REJECTABLE: ReadonlySet<ReportStatus> = new Set(["ready", "needs_clarification", "reviewed", "failed"]);

/** Approve (ink) and Reject (flag outline) side by side, the full width of the column (design-brief §5 A2). */
export function ReviewButtons({ reportId, status }: { reportId: string; status: ReportStatus }) {
  const [approveState, approve] = useActionState<ReviewState, FormData>(approveReport, undefined);
  const [rejectState, reject] = useActionState<ReviewState, FormData>(rejectReport, undefined);
  const canApprove = APPROVABLE.has(status);
  const canReject = REJECTABLE.has(status);
  if (!canApprove && !canReject) return null;
  const error = approveState?.error ?? rejectState?.error;

  return (
    <div className="mt-8">
      <div className="grid grid-cols-2 gap-3">
        <form action={approve}>
          <input type="hidden" name="reportId" value={reportId} />
          <SubmitButton block loadingLabel="Approving…" disabled={!canApprove}>
            Approve
          </SubmitButton>
        </form>
        <form action={reject}>
          <input type="hidden" name="reportId" value={reportId} />
          <SubmitButton block variant="destructive" loadingLabel="Rejecting…" disabled={!canReject}>
            Reject
          </SubmitButton>
        </form>
      </div>
      {error ? (
        <p role="alert" className="mt-3 border-l-4 border-flag pl-3 text-body text-flag">
          {error}
        </p>
      ) : null}
    </div>
  );
}
