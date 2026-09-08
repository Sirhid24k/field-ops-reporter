import { humanize } from "@/lib/format";

/**
 * Alert presentation (A3): the type as a label, the severity as the 4px left edge. Pure.
 * `alerts.type` values come from lib/pipeline/validate.ts (docs/session-3-notes.md).
 */

const TYPE_LABELS: Record<string, string> = {
  odometer_backwards: "Odometer went backwards",
  odometer_jump: "Odometer jump",
  fuel_outlier: "Fuel outlier",
  implausible_value: "Implausible figure",
  duplicate: "Duplicate report",
  missing_report: "Missing report",
};

/** "Breakdown reported" for an incident (from its message), otherwise the fixed label for the type. */
export function alertTypeLabel(type: string, message: string): string {
  if (type === "incident") {
    const match = /^(\S+) reported/.exec(message);
    return match ? `${match[1]} reported` : "Incident reported";
  }
  return TYPE_LABELS[type] ?? humanize(type);
}

export type Severity = "low" | "medium" | "high";

/** Medium and high failed checks in flag; low (an ordinary incident, a missing report) in hazard. */
export function severityEdgeClass(severity: Severity): string {
  return severity === "low" ? "border-hazard" : "border-flag";
}

export function severityLabel(severity: Severity): string {
  return `${humanize(severity)} severity`;
}
