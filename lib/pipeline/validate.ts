import { formatGrouped } from "@/lib/format";

/**
 * Validation (spec §8): deterministic code decides what the numbers mean. Pure functions,
 * no I/O; the state machine feeds them the extracted fields plus the reference data
 * (last approved odometer, org baseline, duplicates) and stores what comes back.
 *
 * Every threshold in the product lives in this file. The messages are the sentences the
 * admin reads on the report detail and in the alerts list, so they are written here.
 */

// ---------------------------------------------------------------------------
// thresholds
// ---------------------------------------------------------------------------

/** Clarification asks about a required field whose extraction confidence is below this. */
export const CONFIDENCE_FLOOR = 0.6;
/** odometer_monotonic: a bigger jump than this per day is flagged (medium). */
export const MAX_DAILY_ODOMETER_JUMP_KM = 1_500;
/** fuel_efficiency: km/L must be within ±40% of the org baseline. */
export const FUEL_EFFICIENCY_TOLERANCE = 0.4;
/** sane_values */
export const MAX_LOAD_TONNAGE = 60;
export const MAX_FUEL_LITERS = 1_000;
export const MAX_FUEL_COST_NGN = 2_000_000;

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type Severity = "low" | "medium" | "high";
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export type IncidentType = "breakdown" | "accident" | "delay" | "checkpoint" | "theft" | "other";
export type Incident = { type: IncidentType; severity: Severity; description: string };

export type ValidationRule = "odometer_monotonic" | "fuel_efficiency" | "sane_values" | "duplicate" | "incident" | "missing_report";

/** Stored as the `validation` jsonb array. `skipped` marks a rule that had nothing to check. */
export type ValidationResult = {
  rule: ValidationRule;
  passed: boolean;
  severity?: Severity;
  message: string;
  skipped?: true;
};

/** `alerts.type` values written by the pipeline. Session 4 maps them to labels. */
export type AlertType =
  | "incident"
  | "odometer_backwards"
  | "odometer_jump"
  | "fuel_outlier"
  | "implausible_value"
  | "duplicate"
  | "missing_report";

export type AlertDraft = { type: AlertType; severity: Severity; message: string };

export type ValidationInput = {
  odometerStart: number | null;
  odometerEnd: number | null;
  fuelLiters: number | null;
  fuelCostNgn: number | null;
  loadTonnage: number | null;
  incidents: Incident[];
  /** vehicles.current_odometer: the last approved reading, null for a vehicle with no history. */
  lastOdometer: number | null;
  /** Days between the last approved report and this one; null when unknown (treated as one day). */
  daysSinceLastOdometer: number | null;
  fuelBaselineKmPerL: number | null;
  /** Another ready/reviewed report exists for the same vehicle and date. */
  hasDuplicate: boolean;
};

export type Verdict = {
  results: ValidationResult[];
  alerts: AlertDraft[];
  /** The distance the checks used: end − start, or end − last approved reading when start is missing. */
  distanceKm: number | null;
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const km = (value: number) => formatGrouped(value);
const rate = (value: number) => formatGrouped(value, { maximumFractionDigits: 1 });
const litres = (value: number) => formatGrouped(value, { maximumFractionDigits: 1 });
const tonnes = (value: number) => formatGrouped(value, { maximumFractionDigits: 1 });
const naira = (value: number) => `₦${formatGrouped(value)}`;

function skipped(rule: ValidationRule, message: string): ValidationResult {
  return { rule, passed: true, skipped: true, message };
}

function passed(rule: ValidationRule, message: string): ValidationResult {
  return { rule, passed: true, message };
}

function failed(rule: ValidationRule, severity: Severity, message: string): ValidationResult {
  return { rule, passed: false, severity, message };
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function sentence(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Distance for the checks. The generated `distance_km` column is end − start; when the
 * driver gave a single reading (the common voice-note case) the last approved reading
 * stands in for the start, and the messages say so.
 */
export function distanceForChecks(input: ValidationInput): number | null {
  if (input.odometerEnd === null) return null;
  if (input.odometerStart !== null) return input.odometerEnd - input.odometerStart;
  if (input.lastOdometer !== null) return input.odometerEnd - input.lastOdometer;
  return null;
}

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------

type RuleOutcome = { result: ValidationResult; alerts: AlertDraft[] };

/** odometer_end >= last approved reading and >= odometer_start; high if lower, medium if the jump is > 1,500 km/day. */
export function checkOdometerMonotonic(input: ValidationInput): RuleOutcome {
  const rule = "odometer_monotonic";
  const { odometerStart: start, odometerEnd: end, lastOdometer: last } = input;
  if (end === null) return { result: skipped(rule, "No odometer reading to check."), alerts: [] };

  if (start !== null && end < start) {
    const message = `Odometer went backwards: the end reading ${km(end)} is below the start reading ${km(start)}.`;
    return { result: failed(rule, "high", message), alerts: [{ type: "odometer_backwards", severity: "high", message }] };
  }
  if (last !== null && end < last) {
    const message = `Odometer went backwards: ${km(end)} is below the last approved reading ${km(last)}.`;
    return { result: failed(rule, "high", message), alerts: [{ type: "odometer_backwards", severity: "high", message }] };
  }

  const reference = start ?? last;
  if (reference === null) {
    return { result: passed(rule, `Odometer ${km(end)} recorded; no earlier reading to compare with.`), alerts: [] };
  }

  const days = start !== null ? 1 : Math.max(1, input.daysSinceLastOdometer ?? 1);
  const jump = end - reference;
  if (jump > MAX_DAILY_ODOMETER_JUMP_KM * days) {
    const span = days === 1 ? "in a day" : `in ${days} days`;
    const message = `Odometer jumped ${km(jump)} km ${span}, from ${km(reference)} to ${km(end)}.`;
    return { result: failed(rule, "medium", message), alerts: [{ type: "odometer_jump", severity: "medium", message }] };
  }

  return { result: passed(rule, `Odometer moved forward, ${km(reference)} → ${km(end)}.`), alerts: [] };
}

/** distance / fuel within ±40% of the org baseline; skipped when the baseline, the fuel or the distance is missing. */
export function checkFuelEfficiency(input: ValidationInput, distanceKm: number | null): RuleOutcome {
  const rule = "fuel_efficiency";
  const baseline = input.fuelBaselineKmPerL;
  if (baseline === null || baseline <= 0) return { result: skipped(rule, "No fuel baseline for this organisation yet."), alerts: [] };
  if (input.fuelLiters === null) return { result: skipped(rule, "No fuel figure to check."), alerts: [] };
  if (input.fuelLiters <= 0) return { result: skipped(rule, "Fuel figure is zero, nothing to check."), alerts: [] };
  if (distanceKm === null) return { result: skipped(rule, "No distance to check fuel use against."), alerts: [] };
  if (distanceKm <= 0) return { result: skipped(rule, "Distance is not positive, so fuel use was not checked."), alerts: [] };

  const kmPerL = distanceKm / input.fuelLiters;
  const low = baseline * (1 - FUEL_EFFICIENCY_TOLERANCE);
  const high = baseline * (1 + FUEL_EFFICIENCY_TOLERANCE);
  const basis = input.odometerStart === null ? " (distance measured from the last approved odometer)" : "";

  if (kmPerL < low || kmPerL > high) {
    const message = `Fuel use ${rate(kmPerL)} km/L, expected ${rate(low)}–${rate(high)}${basis}.`;
    return { result: failed(rule, "medium", message), alerts: [{ type: "fuel_outlier", severity: "medium", message }] };
  }
  return { result: passed(rule, `Fuel use ${rate(kmPerL)} km/L, within the expected ${rate(low)}–${rate(high)}${basis}.`), alerts: [] };
}

/** tonnage ≤ 60, litres ≤ 1,000, cost ≤ ₦2,000,000, and nothing negative. Low severity. */
export function checkSaneValues(input: ValidationInput): RuleOutcome {
  const rule = "sane_values";
  const problems: string[] = [];

  if (input.loadTonnage !== null && input.loadTonnage > MAX_LOAD_TONNAGE) {
    problems.push(`Load ${tonnes(input.loadTonnage)} t is more than a truck carries (over ${tonnes(MAX_LOAD_TONNAGE)} t).`);
  }
  if (input.fuelLiters !== null && input.fuelLiters > MAX_FUEL_LITERS) {
    problems.push(`Fuel ${litres(input.fuelLiters)} L is more than a tank holds (over ${litres(MAX_FUEL_LITERS)} L).`);
  }
  if (input.fuelCostNgn !== null && input.fuelCostNgn > MAX_FUEL_COST_NGN) {
    problems.push(`Fuel cost ${naira(input.fuelCostNgn)} is unusually high (over ${naira(MAX_FUEL_COST_NGN)}).`);
  }
  const negatives: Array<[string, number | null]> = [
    ["Odometer start", input.odometerStart],
    ["Odometer end", input.odometerEnd],
    ["Fuel", input.fuelLiters],
    ["Fuel cost", input.fuelCostNgn],
    ["Load", input.loadTonnage],
  ];
  for (const [label, value] of negatives) {
    if (value !== null && value < 0) problems.push(`${label} cannot be negative (${formatGrouped(value, { maximumFractionDigits: 1 })}).`);
  }

  if (problems.length === 0) return { result: passed(rule, "Figures are within normal ranges."), alerts: [] };
  const message = problems.join(" ");
  return { result: failed(rule, "low", message), alerts: [{ type: "implausible_value", severity: "low", message }] };
}

/** Another ready/reviewed report for the same vehicle and date. Medium. */
export function checkDuplicate(input: ValidationInput): RuleOutcome {
  const rule = "duplicate";
  if (!input.hasDuplicate) return { result: passed(rule, "First report for this vehicle on this date."), alerts: [] };
  const message = "Another report for this vehicle on this date was already sent.";
  return { result: failed(rule, "medium", message), alerts: [{ type: "duplicate", severity: "medium", message }] };
}

const INCIDENT_LABELS: Record<IncidentType, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  delay: "Delay",
  checkpoint: "Checkpoint",
  theft: "Theft",
  other: "Incident",
};

/** Severity for an incident: the model's, but never below medium for an accident or a theft. */
export function incidentSeverity(incident: Incident): Severity {
  const floor: Severity = incident.type === "accident" || incident.type === "theft" ? "medium" : "low";
  return maxSeverity(incident.severity, floor);
}

/** Any incident extracted fails this rule; one alert per incident. */
export function checkIncidents(input: ValidationInput): RuleOutcome {
  const rule = "incident";
  if (input.incidents.length === 0) return { result: passed(rule, "No incidents reported."), alerts: [] };

  const alerts: AlertDraft[] = input.incidents.map((incident) => {
    const label = INCIDENT_LABELS[incident.type] ?? INCIDENT_LABELS.other;
    const description = sentence(incident.description);
    return {
      type: "incident",
      severity: incidentSeverity(incident),
      message: description ? `${label} reported: ${description}` : `${label} reported.`,
    };
  });
  const severity = alerts.map((alert) => alert.severity).reduce(maxSeverity, "low");
  return { result: failed(rule, severity, alerts.map((alert) => alert.message).join(" ")), alerts };
}

/** missing_report is cron-only (no report row to attach to); the digest cron builds the alert from this. */
export function missingReportAlert(plate: string, dayLabel: string): AlertDraft {
  return { type: "missing_report", severity: "low", message: `No report from ${plate} on ${dayLabel}.` };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export function validateReport(input: ValidationInput): Verdict {
  const distanceKm = distanceForChecks(input);
  const outcomes = [
    checkOdometerMonotonic(input),
    checkFuelEfficiency(input, distanceKm),
    checkSaneValues(input),
    checkDuplicate(input),
    checkIncidents(input),
  ];
  return {
    results: outcomes.map((outcome) => outcome.result),
    alerts: outcomes.flatMap((outcome) => outcome.alerts),
    distanceKm,
  };
}
