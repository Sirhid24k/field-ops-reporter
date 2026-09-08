import { describe, expect, it } from "vitest";
import { decideClarification, isUnclear, missingRequiredFields } from "./clarify";
import { extractionSchema, type Extraction } from "./extract";

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return extractionSchema.parse({
    report_date: "2026-09-08",
    trip_status: "completed",
    origin: "Kaduna",
    destination: "Kano",
    waypoints: [],
    load_type: "cement",
    load_tonnage: 30,
    odometer_start: null,
    odometer_end: 184434,
    fuel_liters: 48,
    fuel_price_per_l_ngn: null,
    fuel_cost_ngn: 52000,
    expenses: [],
    incidents: [],
    notes: null,
    confidence: { origin: 1, destination: 1, odometer_end: 1, fuel_liters: 1, fuel_cost_ngn: 1 },
    missing_fields: [],
    clarifying_questions: [],
    ...overrides,
  });
}

describe("missingRequiredFields", () => {
  it("asks for nothing when a completed trip is complete", () => {
    expect(missingRequiredFields(extraction())).toEqual([]);
  });

  it("asks for absent required fields of a completed trip, most useful first", () => {
    expect(missingRequiredFields(extraction({ odometer_end: null, origin: null, confidence: { odometer_end: 0, origin: 0, destination: 1, fuel_liters: 1 } }))).toEqual([
      "odometer_end",
      "origin",
    ]);
  });

  it("treats a number scored below the floor as missing", () => {
    expect(missingRequiredFields(extraction({ confidence: { odometer_end: 0.4, origin: 1, destination: 1, fuel_liters: 1 } }))).toEqual(["odometer_end"]);
  });

  it("asks about an unclear number even when the trip is still in progress", () => {
    // the real 8 Sep report: "my meter read 1 to 65.78" → odometer_end null, confidence 0.3, trip in progress
    const inProgress = extraction({
      trip_status: "in_progress",
      origin: null,
      destination: "Alpana, Kogi",
      odometer_end: null,
      fuel_liters: 450,
      fuel_price_per_l_ngn: 1760,
      fuel_cost_ngn: null,
      confidence: { origin: 0, destination: 1, odometer_end: 0.3, fuel_liters: 1, fuel_price_per_l_ngn: 1 },
      missing_fields: ["origin", "odometer_end"],
      clarifying_questions: ["What did your odometer read exactly?", "Where did you start your journey from?"],
    });
    expect(isUnclear(inProgress, "odometer_end")).toBe(true);
    expect(missingRequiredFields(inProgress)).toEqual(["odometer_end"]);
    expect(decideClarification(inProgress, 0)).toEqual({
      ask: true,
      missing: ["odometer_end"],
      questions: ["What did your odometer read exactly?", "Where did you start your journey from?"],
    });
  });

  it("does not ask about a number the driver simply has not given yet on a trip in progress", () => {
    const inProgress = extraction({ trip_status: "in_progress", odometer_end: null, confidence: { odometer_end: 0, destination: 1, fuel_liters: 1 } });
    expect(isUnclear(inProgress, "odometer_end")).toBe(false);
    expect(missingRequiredFields(inProgress)).toEqual([]);
    expect(decideClarification(inProgress, 0).ask).toBe(false);
  });

  it("needs the litres when a price per litre was quoted without them", () => {
    expect(missingRequiredFields(extraction({ fuel_liters: null, fuel_cost_ngn: null, fuel_price_per_l_ngn: 1760, confidence: { origin: 1, destination: 1, odometer_end: 1 } }))).toEqual([
      "fuel_liters",
    ]);
  });
});

describe("decideClarification", () => {
  it("asks once: an answered round means no second question", () => {
    const missing = extraction({ odometer_end: null, confidence: { odometer_end: 0, origin: 1, destination: 1, fuel_liters: 1 } });
    expect(decideClarification(missing, 0).ask).toBe(true);
    expect(decideClarification(missing, 1)).toEqual({ ask: false, missing: ["odometer_end"], questions: [] });
  });

  it("uses the model's wording, deduplicated and capped at two, else generated questions", () => {
    const withWording = extraction({
      odometer_end: null,
      confidence: { odometer_end: 0, origin: 1, destination: 1, fuel_liters: 1 },
      clarifying_questions: ["Abeg, wetin be the odometer reading", "Abeg, wetin be the odometer reading", "How many litres?", "Third one"],
    });
    expect(decideClarification(withWording, 0).questions).toEqual(["Abeg, wetin be the odometer reading?", "How many litres?"]);

    const withoutWording = extraction({ odometer_end: null, origin: null, confidence: { odometer_end: 0, origin: 0, destination: 1, fuel_liters: 1 } });
    expect(decideClarification(withoutWording, 0).questions).toEqual(["What did the odometer read when you stopped?", "Where did you start the trip from?"]);
  });
});
