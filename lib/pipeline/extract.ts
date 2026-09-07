import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { ModelOutputError, UnrecoverableError } from "./errors";
import { generateJson, modelFor } from "./gemini";

/**
 * Extraction (spec §6): the model turns language into raw fields. It never computes,
 * compares or validates a number; lib/pipeline/validate.ts does that. The response schema
 * is spec §6 exactly; the model's output is still untrusted input and goes through zod
 * before anything is written.
 */

export const TRIP_STATUSES = ["completed", "in_progress", "not_started", "blocked"] as const;
export const INCIDENT_TYPES = ["breakdown", "accident", "delay", "checkpoint", "theft", "other"] as const;
export const SEVERITIES = ["low", "medium", "high"] as const;

/** Every field that gets a confidence score (spec §6 `confidence: {"<field>": 0.0}`). */
export const SCORED_FIELDS = [
  "report_date",
  "trip_status",
  "origin",
  "destination",
  "waypoints",
  "load_type",
  "load_tonnage",
  "odometer_start",
  "odometer_end",
  "fuel_liters",
  "fuel_cost_ngn",
  "expenses",
  "incidents",
  "notes",
] as const;

const OUTPUT_KEYS = [
  ...SCORED_FIELDS.slice(0, 14),
  "confidence",
  "missing_fields",
  "clarifying_questions",
] as const;

const nullableString: Schema = { type: Type.STRING, nullable: true };
const nullableNumber: Schema = { type: Type.NUMBER, nullable: true };

/** Gemini structured output: `responseMimeType: "application/json"` + this schema (spec §6). */
export const EXTRACTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    report_date: { type: Type.STRING, description: "The date the report covers, YYYY-MM-DD." },
    trip_status: { type: Type.STRING, enum: [...TRIP_STATUSES] },
    origin: { ...nullableString, description: "Where the trip started." },
    destination: { ...nullableString, description: "Where the load was delivered or the trip ended." },
    waypoints: { type: Type.ARRAY, items: { type: Type.STRING } },
    load_type: { ...nullableString, description: "What was carried, e.g. cement, gravel, diesel." },
    load_tonnage: { ...nullableNumber, description: "Load weight in tonnes." },
    odometer_start: { ...nullableNumber, description: "Odometer reading in km at the start, only if the driver gave two readings." },
    odometer_end: { ...nullableNumber, description: "Odometer reading in km at the end; a single reading goes here." },
    fuel_liters: { ...nullableNumber, description: "Fuel bought, in litres." },
    fuel_cost_ngn: { ...nullableNumber, description: "What the fuel cost, in naira." },
    expenses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          amount_ngn: { type: Type.NUMBER },
          note: { type: Type.STRING },
        },
        required: ["category", "amount_ngn", "note"],
      },
    },
    incidents: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: [...INCIDENT_TYPES] },
          severity: { type: Type.STRING, enum: [...SEVERITIES] },
          description: { type: Type.STRING },
        },
        required: ["type", "severity", "description"],
      },
    },
    notes: { ...nullableString, description: "Anything else the driver said that matters to the office." },
    confidence: {
      type: Type.OBJECT,
      properties: Object.fromEntries(SCORED_FIELDS.map((field) => [field, { type: Type.NUMBER }])),
      required: [...SCORED_FIELDS],
    },
    missing_fields: { type: Type.ARRAY, items: { type: Type.STRING } },
    clarifying_questions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [...OUTPUT_KEYS],
  propertyOrdering: [...OUTPUT_KEYS],
};

// ---------------------------------------------------------------------------
// zod: the model's output is untrusted input
// ---------------------------------------------------------------------------

const text = z.string().transform((value) => value.trim());
const optionalText = z
  .string()
  .nullish()
  .transform((value) => (value && value.trim() ? value.trim() : null));
const optionalNumber = z
  .number()
  .nullish()
  .transform((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));

const expenseSchema = z.object({
  category: text,
  amount_ngn: optionalNumber,
  note: optionalText,
});

const incidentSchema = z.object({
  type: z.enum(INCIDENT_TYPES),
  severity: z.enum(SEVERITIES),
  description: text,
});

function clampConfidence(raw: Record<string, number | null>): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) clean[field] = Math.min(1, Math.max(0, value));
  }
  return clean;
}

export const extractionSchema = z.object({
  report_date: text,
  trip_status: z.enum(TRIP_STATUSES),
  origin: optionalText,
  destination: optionalText,
  waypoints: z.array(text).default([]),
  load_type: optionalText,
  load_tonnage: optionalNumber,
  odometer_start: optionalNumber,
  odometer_end: optionalNumber,
  fuel_liters: optionalNumber,
  fuel_cost_ngn: optionalNumber,
  expenses: z.array(expenseSchema).default([]),
  incidents: z.array(incidentSchema).default([]),
  notes: optionalText,
  confidence: z.record(z.string(), z.number().nullable()).default({}).transform(clampConfidence),
  missing_fields: z.array(z.string()).default([]),
  clarifying_questions: z.array(z.string()).default([]),
});

export type Extraction = z.output<typeof extractionSchema>;
export type ExtractedIncident = Extraction["incidents"][number];

/** The columns copied out of `extracted` for querying (spec §7 "promoted fields"). */
export function promotedColumns(extraction: Extraction) {
  return {
    trip_status: extraction.trip_status,
    origin: extraction.origin,
    destination: extraction.destination,
    odometer_start: extraction.odometer_start,
    odometer_end: extraction.odometer_end,
    fuel_liters: extraction.fuel_liters,
    fuel_cost_ngn: extraction.fuel_cost_ngn,
    load_type: extraction.load_type,
    load_tonnage: extraction.load_tonnage,
  };
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

export type ExtractionContext = {
  transcript: string;
  transcriptLanguage: string | null;
  /** A typed note sent alongside a voice note (null for text-only reports, whose note is the transcript). */
  typedNote: string | null;
  reportDate: string;
  plate: string;
  vehicleLabel: string | null;
  /** vehicles.current_odometer: the last approved reading for this vehicle. */
  lastOdometer: number | null;
  fuelBaselineKmPerL: number | null;
  /** Clarification questions the office asked and the driver's answers, oldest first. */
  thread: Array<{ question: string; answer: string }>;
};

/**
 * Spec §6 prompt rules, plus the two the product claim depends on: never invent a number,
 * never copy a context number into a field.
 */
export const EXTRACTION_SYSTEM_PROMPT = [
  "You turn a Nigerian truck driver's daily report into structured JSON. The driver speaks English or Nigerian Pidgin, often mixing both.",
  "",
  "Rules",
  "- Extract only what was said. Never invent, estimate, round or complete a number. A field the driver did not mention is null.",
  '- Spoken amounts become numbers: "one-twenty thousand naira" is 120000, "forty litres" is 40, "one eight four, four three four" is 184434, "two and a half tonnes" is 2.5.',
  '- Treat Pidgin phrasing correctly: "motor spoil" is a breakdown, "we buy fuel 40 litres" means fuel_liters 40, "we don reach Kano" means Kano was reached, "police stop us for checkpoint" is a checkpoint incident, "na" is "is", "wahala" is trouble and "no wahala" means no problems.',
  "- If the odometer is given as one number, put it in odometer_end and leave odometer_start null.",
  "- Required fields for a completed trip: origin, destination, odometer_end, and fuel_liters if fuel was bought. Put the names of the required fields that are missing in missing_fields.",
  "- The context lines (last approved odometer, fuel baseline) are there so you can understand the driver and ask sharper questions. Never copy a context number into a field.",
  "- confidence: a number from 0 to 1 for every field. 1 when the driver stated it plainly, lower when the recording was unclear or you had to interpret, 0 when absent.",
  "- clarifying_questions: at most 2, one short plain sentence each, worded for the driver in the language they used, only about missing required fields. Empty when nothing is missing.",
  "- report_date: the date the report covers, normally the report date you are given.",
  "- Do not judge whether a number is plausible; that is checked elsewhere. Record what was said.",
  "- Answer with JSON only.",
].join("\n");

export function buildExtractionPrompt(context: ExtractionContext): string {
  const lines = [
    `Report date: ${context.reportDate}`,
    `Vehicle: ${context.plate}${context.vehicleLabel ? ` (${context.vehicleLabel})` : ""}`,
    `Last approved odometer reading for this vehicle: ${context.lastOdometer === null ? "unknown" : `${context.lastOdometer} km`}`,
    `Organisation fuel baseline: ${context.fuelBaselineKmPerL === null ? "not set" : `${context.fuelBaselineKmPerL} km per litre`}`,
    `Transcript language: ${context.transcriptLanguage ?? "unknown"}`,
    "",
    "Transcript of the voice note:",
    '"""',
    context.transcript.trim() || "(no recording)",
    '"""',
    "",
    "Typed note from the driver:",
    '"""',
    context.typedNote?.trim() || "(none)",
    '"""',
  ];
  if (context.thread.length > 0) {
    lines.push("", "The office asked follow-up questions and the driver answered. Treat the answers as part of the report:");
    for (const turn of context.thread) lines.push(`Q: ${turn.question}`, `A: ${turn.answer}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// call
// ---------------------------------------------------------------------------

type Attempt = { ok: true; value: Extraction } | { ok: false; problem: string };

async function attempt(model: string, prompt: string): Promise<Attempt> {
  let raw: unknown;
  try {
    raw = await generateJson({
      model,
      system: EXTRACTION_SYSTEM_PROMPT,
      prompt,
      schema: EXTRACTION_RESPONSE_SCHEMA,
      temperature: 0.1,
    });
  } catch (error) {
    if (error instanceof ModelOutputError) return { ok: false, problem: `${error.message} It started with: ${error.detail.slice(0, 200)}` };
    throw error;
  }
  const parsed = extractionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return { ok: false, problem: `The JSON did not match the schema: ${issues.join("; ")}.` };
}

/**
 * One structured call; on a schema failure, one retry with the error appended; then the
 * report fails. Rate limits and network errors propagate as RetryableError from gemini.ts.
 */
export async function extractReport(context: ExtractionContext): Promise<Extraction> {
  const model = modelFor("extraction");
  const prompt = buildExtractionPrompt(context);

  const first = await attempt(model, prompt);
  if (first.ok) return first.value;

  const second = await attempt(
    model,
    `${prompt}\n\nYour previous answer was rejected: ${first.problem}\nReturn the corrected JSON only.`,
  );
  if (second.ok) return second.value;

  throw new UnrecoverableError(`The model's output did not match the report schema, even after a retry. ${second.problem}`);
}
