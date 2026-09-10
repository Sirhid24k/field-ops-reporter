import { describe, expect, it } from "vitest";
import { extractionSchema, promotedColumns, SCORED_FIELDS, EXTRACTION_RESPONSE_SCHEMA } from "./extract";
import { deriveFuelCost } from "./validate";

describe("deriveFuelCost", () => {
  it("multiplies litres by the per-litre price when no total was stated", () => {
    expect(deriveFuelCost({ fuelLiters: 450, fuelCostNgn: null, fuelPricePerLNgn: 1760 })).toBe(792_000);
    expect(deriveFuelCost({ fuelLiters: 48, fuelCostNgn: null, fuelPricePerLNgn: 1083.33 })).toBe(52_000);
  });

  it("keeps a stated total over the multiplication", () => {
    expect(deriveFuelCost({ fuelLiters: 450, fuelCostNgn: 800_000, fuelPricePerLNgn: 1760 })).toBe(800_000);
  });

  it("stays null when either factor is missing or not positive", () => {
    expect(deriveFuelCost({ fuelLiters: null, fuelCostNgn: null, fuelPricePerLNgn: 1760 })).toBeNull();
    expect(deriveFuelCost({ fuelLiters: 450, fuelCostNgn: null, fuelPricePerLNgn: null })).toBeNull();
    expect(deriveFuelCost({ fuelLiters: 0, fuelCostNgn: null, fuelPricePerLNgn: 1760 })).toBeNull();
    expect(deriveFuelCost({ fuelLiters: 450, fuelCostNgn: null, fuelPricePerLNgn: -1 })).toBeNull();
  });
});

describe("promotion", () => {
  const base = {
    report_date: "2026-09-08",
    trip_status: "in_progress",
    origin: null,
    destination: "Alpana, Kogi State",
    waypoints: [],
    load_type: null,
    load_tonnage: null,
    odometer_start: null,
    odometer_end: null,
    fuel_liters: 450,
    fuel_price_per_l_ngn: 1760,
    fuel_cost_ngn: null,
    expenses: [],
    incidents: [],
    notes: null,
    confidence: { fuel_liters: 1, fuel_price_per_l_ngn: 1, odometer_end: 0.3 },
    missing_fields: ["odometer_end"],
    clarifying_questions: ["What did the odometer read when you stopped?"],
  };

  it("promotes the computed fuel cost while the raw record keeps the model's null", () => {
    const extraction = extractionSchema.parse(base);
    expect(extraction.fuel_cost_ngn).toBeNull();
    expect(extraction.fuel_price_per_l_ngn).toBe(1760);
    expect(promotedColumns(extraction).fuel_cost_ngn).toBe(792_000);
  });

  it("scores the price per litre and keeps the schema's keys in step", () => {
    expect(SCORED_FIELDS).toContain("fuel_price_per_l_ngn");
    const keys = [...SCORED_FIELDS, "transcript_language", "confidence", "missing_fields", "clarifying_questions"];
    const properties = EXTRACTION_RESPONSE_SCHEMA.properties ?? {};
    expect(Object.keys(properties)).toEqual(keys);
    expect(EXTRACTION_RESPONSE_SCHEMA.required).toEqual(keys);
  });

  it("takes the language chip from the model, as one of two labels or nothing", () => {
    expect(extractionSchema.parse({ ...base, transcript_language: "Pidgin" }).transcript_language).toBe("Pidgin");
    expect(extractionSchema.parse({ ...base, transcript_language: "English" }).transcript_language).toBe("English");
    expect(extractionSchema.parse(base).transcript_language).toBeNull();
    expect(extractionSchema.parse({ ...base, transcript_language: "Yoruba" }).transcript_language).toBeNull();
  });
});
