import { formatGrouped, humanize } from "@/lib/format";
import type { Json } from "@/lib/supabase/types";

/**
 * The "What the system understood" list on the report detail (A2): which columns a
 * supervisor can edit, how each is parsed from the input and shown, and how the stored
 * `validation` and `extracted` JSON are read. Pure; shared by the page, the client field
 * list and the edit action. No pipeline imports, so it is safe in the client bundle.
 */

export const EDITABLE_FIELDS = [
  "origin",
  "destination",
  "trip_status",
  "odometer_start",
  "odometer_end",
  "fuel_liters",
  "fuel_cost_ngn",
  "load_type",
  "load_tonnage",
  "notes",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type FieldKind = "text" | "integer" | "decimal" | "trip_status";

export const FIELD_KINDS: Record<EditableField, FieldKind> = {
  origin: "text",
  destination: "text",
  trip_status: "trip_status",
  odometer_start: "integer",
  odometer_end: "integer",
  fuel_liters: "decimal",
  fuel_cost_ngn: "integer",
  load_type: "text",
  load_tonnage: "decimal",
  notes: "text",
};

/** Labels for the inputs inside an editor (the row labels are on the page). */
export const FIELD_LABELS: Record<EditableField, string> = {
  origin: "Origin",
  destination: "Destination",
  trip_status: "Trip status",
  odometer_start: "Odometer start",
  odometer_end: "Odometer end",
  fuel_liters: "Fuel, litres",
  fuel_cost_ngn: "Fuel cost, naira",
  load_type: "Load",
  load_tonnage: "Tonnes",
  notes: "Notes",
};

/** Mirrors TRIP_STATUSES in lib/pipeline/extract.ts (asserted by a test; not imported, to keep the SDK out of the client). */
export const TRIP_STATUS_VALUES = ["completed", "in_progress", "not_started", "blocked"] as const;

/** Fields can be fixed before a report is approved, and while nothing is still moving. */
export const EDITABLE_STATUSES: ReadonlySet<string> = new Set(["ready", "needs_clarification", "rejected", "failed"]);

export type FieldValue = string | number | null;

// ---------------------------------------------------------------------------
// JSON columns
// ---------------------------------------------------------------------------

export type JsonObject = { [key: string]: Json | undefined };

export function asObject(value: Json | null | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export type ValidationView = { rule: string; passed: boolean; skipped: boolean; message: string; severity: string | null };

/** The stored `validation` array, defensively. Null when the checks have not run. */
export function parseValidation(value: Json | null): ValidationView[] | null {
  if (!Array.isArray(value)) return null;
  const out: ValidationView[] = [];
  for (const raw of value) {
    const entry = asObject(raw);
    if (!entry || typeof entry.rule !== "string" || typeof entry.message !== "string") continue;
    out.push({
      rule: entry.rule,
      passed: entry.passed !== false,
      skipped: entry.skipped === true,
      message: entry.message,
      severity: typeof entry.severity === "string" ? entry.severity : null,
    });
  }
  return out;
}

export type IncidentView = { type: string; severity: string; description: string };

export function incidentsFrom(extracted: JsonObject | null): IncidentView[] {
  const list = extracted?.incidents;
  if (!Array.isArray(list)) return [];
  const out: IncidentView[] = [];
  for (const raw of list) {
    const entry = asObject(raw);
    if (!entry) continue;
    out.push({
      type: typeof entry.type === "string" ? entry.type : "other",
      severity: typeof entry.severity === "string" ? entry.severity : "low",
      description: typeof entry.description === "string" ? entry.description : "",
    });
  }
  return out;
}

/** "Breakdown: gearbox failed near Kaduna." — one line per incident. */
export function incidentLine(incident: IncidentView): string {
  const label = humanize(incident.type);
  return incident.description ? `${label}: ${incident.description}` : label;
}

/** Which values failed a check, so they render in flag with a "!" (design-brief §5 A1/A2). */
export function flaggedFields(results: ValidationView[] | null): Set<EditableField | "distance"> {
  const flagged = new Set<EditableField | "distance">();
  for (const result of results ?? []) {
    if (result.passed) continue;
    if (result.rule === "odometer_monotonic") {
      flagged.add("odometer_end");
      flagged.add("distance");
    } else if (result.rule === "fuel_efficiency") {
      flagged.add("fuel_liters");
    } else if (result.rule === "sane_values") {
      if (/\bLoad\b/.test(result.message)) flagged.add("load_tonnage");
      if (/\bFuel cost\b/.test(result.message)) flagged.add("fuel_cost_ngn");
      if (/\bFuel(?! cost)\b/.test(result.message)) flagged.add("fuel_liters");
      if (/\bOdometer start\b/.test(result.message)) flagged.add("odometer_start");
      if (/\bOdometer end\b/.test(result.message)) flagged.add("odometer_end");
    }
  }
  return flagged;
}

// ---------------------------------------------------------------------------
// values in and out
// ---------------------------------------------------------------------------

const TEXT_LIMITS: Partial<Record<EditableField, number>> = { notes: 2000 };
const MAX_NUMBER = 9_999_999;

export type ParsedInput = { ok: true; value: FieldValue } | { ok: false; message: string };

/** What was typed into an editor → the value to store (null clears the field). */
export function parseFieldInput(field: EditableField, raw: string): ParsedInput {
  const kind = FIELD_KINDS[field];
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  if (kind === "text") {
    const limit = TEXT_LIMITS[field] ?? 200;
    if (trimmed.length > limit) return { ok: false, message: `Keep it under ${limit} characters.` };
    return { ok: true, value: trimmed };
  }
  if (kind === "trip_status") {
    return (TRIP_STATUS_VALUES as readonly string[]).includes(trimmed)
      ? { ok: true, value: trimmed }
      : { ok: false, message: "Pick a trip status from the list." };
  }

  const number = Number(trimmed.replace(/^₦/, "").replace(/[\s,  ]/g, ""));
  if (!Number.isFinite(number)) return { ok: false, message: "Enter a number, like 184220." };
  if (number < 0) return { ok: false, message: "Enter a number of 0 or more." };
  if (number > MAX_NUMBER) return { ok: false, message: "That number is too large." };
  return { ok: true, value: kind === "integer" ? Math.round(number) : Math.round(number * 10) / 10 };
}

/** How a stored value reads in the list: grouped digits with the unit, enum values as words. */
export function formatFieldValue(field: EditableField | "distance", value: FieldValue): string | null {
  if (value === null || value === "") return null;
  switch (field) {
    case "odometer_start":
    case "odometer_end":
      return formatGrouped(Number(value));
    case "distance":
      return `${formatGrouped(Number(value))} km`;
    case "fuel_liters":
      return `${formatGrouped(Number(value), { maximumFractionDigits: 1 })} L`;
    case "fuel_cost_ngn":
      return `₦${formatGrouped(Number(value))}`;
    case "load_tonnage":
      return `${formatGrouped(Number(value), { maximumFractionDigits: 1 })} t`;
    case "trip_status":
      return humanize(String(value));
    default:
      return String(value);
  }
}

/** The plain form of a stored value, for the input's initial text. */
export function inputValue(value: FieldValue): string {
  return value === null ? "" : String(value);
}

/** Two values are the same field content (so an unchanged save is a no-op). */
export function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (a === null || b === null) return a === b;
  return typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : a === b;
}
