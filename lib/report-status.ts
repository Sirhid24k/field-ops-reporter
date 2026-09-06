import type { ChipStatus } from "@/components/ui";
import type { Enums } from "@/lib/supabase/types";

export type ReportStatus = Enums<"report_status">;

/** Statuses the pipeline moves through on its own; Today polls while a report is in one. */
export const MOVING_STATUSES: readonly ReportStatus[] = ["queued", "transcribing", "extracting", "validating"];

export function isMoving(status: ReportStatus): boolean {
  return MOVING_STATUSES.includes(status);
}

/**
 * report_status → the status vocabulary (design-brief §3). `failed` has no chip:
 * it gets the flag treatment with its own copy instead.
 */
export function chipForStatus(status: ReportStatus): ChipStatus | null {
  switch (status) {
    case "queued":
      return "queued";
    case "transcribing":
    case "extracting":
    case "validating":
      return "processing";
    case "needs_clarification":
      return "needs_answer";
    case "ready":
      return "sent";
    case "reviewed":
      return "approved";
    case "rejected":
      return "rejected";
    case "failed":
      return null;
  }
}

/** The status card variants on Today (design-brief §4/F2 plus rejected and failed). */
export type TodayVariant = "not_reported" | "queued" | "processing" | "needs_answer" | "sent" | "rejected" | "failed";

export function todayVariantFor(status: ReportStatus): TodayVariant {
  switch (status) {
    case "queued":
      return "queued";
    case "transcribing":
    case "extracting":
    case "validating":
      return "processing";
    case "needs_clarification":
      return "needs_answer";
    case "ready":
    case "reviewed":
      return "sent";
    case "rejected":
      return "rejected";
    case "failed":
      return "failed";
  }
}
