import { cn } from "@/lib/cn";

/** The eight states of the status vocabulary (design-brief §3), identical on both surfaces. */
export type ChipStatus =
  | "not_reported"
  | "queued"
  | "processing"
  | "needs_answer"
  | "sent"
  | "approved"
  | "rejected"
  | "alert";

export type Surface = "field" | "admin";

export const CHIP_STATUSES: ChipStatus[] = [
  "not_reported",
  "queued",
  "processing",
  "needs_answer",
  "sent",
  "approved",
  "rejected",
  "alert",
];

const LABELS: Record<ChipStatus, Record<Surface, string>> = {
  not_reported: { field: "Not reported", admin: "Not reported" },
  queued: { field: "Queued", admin: "Queued" },
  processing: { field: "Processing", admin: "Processing" },
  needs_answer: { field: "Needs your answer", admin: "Needs answer" },
  sent: { field: "Sent", admin: "Ready to review" },
  approved: { field: "Approved", admin: "Approved" },
  rejected: { field: "Rejected", admin: "Rejected" },
  alert: { field: "Alert", admin: "Alert" },
};

/* outline = 1px border in the color; fill = the same border over a 12% tint. Text is the color,
   except on the hazard tint where hazard-ink keeps the contrast. */
const TREATMENTS: Record<ChipStatus, string> = {
  not_reported: "border-steel text-steel",
  queued: "border-steel bg-steel/12 text-steel",
  processing: "border-ink text-ink",
  needs_answer: "border-hazard bg-hazard/12 text-hazard-ink",
  sent: "border-convoy text-convoy",
  approved: "border-convoy bg-convoy/12 text-convoy",
  rejected: "border-flag text-flag",
  alert: "border-flag bg-flag/12 text-flag",
};

export type StatusChipProps = {
  status: ChipStatus;
  /** Two labels differ between surfaces: needs_answer and sent. */
  surface?: Surface;
  /** Alert chips carry a count: "Alert 2". */
  count?: number;
  className?: string;
};

export function chipLabel(status: ChipStatus, surface: Surface, count?: number): string {
  const label = LABELS[status][surface];
  return status === "alert" && count !== undefined ? `${label} ${count}` : label;
}

export function StatusChip({ status, surface = "field", count, className }: StatusChipProps) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex min-h-6 items-center rounded-control border px-2 font-display text-body font-semibold leading-5 tabular",
        TREATMENTS[status],
        className,
      )}
    >
      {/* the pulse is on the text only, and only while processing */}
      <span className={status === "processing" ? "animate-text-pulse" : undefined}>
        {chipLabel(status, surface, count)}
      </span>
    </span>
  );
}
