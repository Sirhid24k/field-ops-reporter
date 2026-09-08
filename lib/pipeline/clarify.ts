import type { Extraction } from "./extract";
import { CONFIDENCE_FLOOR } from "./validate";

/**
 * Clarification (spec M11): after validation, if a §6-required field is missing or the
 * model was not sure of it, ask the driver, once. A report that already has an answered
 * clarification goes to `ready` with its gaps visible; it is never asked again.
 *
 * Two things earn a question: a required field of a completed trip that is missing or
 * scored below the confidence floor, and a number the driver did say but that could not be
 * read (scored above zero and below the floor: a garbled odometer, litres split by the
 * speech-to-text), whatever the trip status. Absent numbers on a trip still in progress are
 * not asked about; the driver has not reached the end yet.
 *
 * The decision is code; the model only supplies the wording of the questions.
 */

export const MAX_QUESTIONS = 2;

/** Required for a completed trip (spec §6), in the order they are worth asking about. */
const REQUIRED_PRIORITY = ["odometer_end", "destination", "origin", "fuel_liters"] as const;
type RequiredField = (typeof REQUIRED_PRIORITY)[number];

/** Short, driver-worded fallbacks when the model gave no question. */
const GENERATED_QUESTIONS: Record<RequiredField, string> = {
  odometer_end: "What did the odometer read when you stopped?",
  destination: "Where did you deliver to?",
  origin: "Where did you start the trip from?",
  fuel_liters: "How many litres of fuel did you buy?",
};

export type ClarificationDecision = {
  ask: boolean;
  /** Required fields that are missing or below the confidence floor. */
  missing: RequiredField[];
  questions: string[];
};

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** The numbers the driver may have said unclearly; an unclear one is worth a question on any trip. */
const NUMBER_FIELDS: readonly RequiredField[] = ["odometer_end", "fuel_liters"];

/** Scored, but below the floor: the driver said it and it could not be read (0 means absent). */
export function isUnclear(extraction: Extraction, field: RequiredField): boolean {
  const confidence = extraction.confidence[field];
  return typeof confidence === "number" && confidence > 0 && confidence < CONFIDENCE_FLOOR;
}

/** Fields worth a question: required ones that are absent or below CONFIDENCE_FLOOR, and unclear numbers. */
export function missingRequiredFields(extraction: Extraction): RequiredField[] {
  const required = new Set<RequiredField>();
  if (extraction.trip_status === "completed") {
    for (const field of ["odometer_end", "destination", "origin"] as const) required.add(field);
    // "fuel_liters (if fuel was bought)": a cost or a price without litres, or the model saying litres are missing
    if (extraction.fuel_cost_ngn !== null || extraction.fuel_price_per_l_ngn !== null || extraction.missing_fields.includes("fuel_liters")) {
      required.add("fuel_liters");
    }
  }
  for (const field of NUMBER_FIELDS) if (isUnclear(extraction, field)) required.add(field);

  return REQUIRED_PRIORITY.filter((field) => {
    if (!required.has(field)) return false;
    if (isBlank(extraction[field])) return true;
    const confidence = extraction.confidence[field];
    return typeof confidence === "number" && confidence < CONFIDENCE_FLOOR;
  });
}

function cleanQuestion(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!text) return null;
  return /[?.!]$/.test(text) ? text : `${text}?`;
}

/**
 * `answeredRounds` = rounds the driver has already answered on this report. Anything
 * above zero means the one allowed round is spent.
 */
export function decideClarification(extraction: Extraction, answeredRounds: number): ClarificationDecision {
  const missing = missingRequiredFields(extraction);
  if (missing.length === 0 || answeredRounds > 0) return { ask: false, missing, questions: [] };

  const fromModel = Array.from(
    new Set(extraction.clarifying_questions.map(cleanQuestion).filter((question): question is string => question !== null)),
  ).slice(0, MAX_QUESTIONS);

  const questions = fromModel.length > 0 ? fromModel : missing.slice(0, MAX_QUESTIONS).map((field) => GENERATED_QUESTIONS[field]);
  return { ask: true, missing, questions };
}
