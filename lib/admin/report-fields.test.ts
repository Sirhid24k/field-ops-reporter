import { describe, expect, it } from "vitest";
import { THIN_SPACE } from "@/lib/format";
import { TRIP_STATUSES } from "@/lib/pipeline/extract";
import { flaggedFields, formatFieldValue, parseFieldInput, parseValidation, sameValue, TRIP_STATUS_VALUES } from "./report-fields";

describe("report fields", () => {
  it("keeps the trip statuses in step with the extraction schema", () => {
    expect([...TRIP_STATUS_VALUES]).toEqual([...TRIP_STATUSES]);
  });

  it("parses what a supervisor types", () => {
    expect(parseFieldInput("odometer_end", " 184 434 ")).toEqual({ ok: true, value: 184434 });
    expect(parseFieldInput("fuel_cost_ngn", "₦52,000")).toEqual({ ok: true, value: 52000 });
    expect(parseFieldInput("fuel_liters", "48.25")).toEqual({ ok: true, value: 48.3 });
    expect(parseFieldInput("odometer_end", "")).toEqual({ ok: true, value: null });
    expect(parseFieldInput("odometer_end", "abc").ok).toBe(false);
    expect(parseFieldInput("odometer_end", "-5").ok).toBe(false);
    expect(parseFieldInput("trip_status", "completed")).toEqual({ ok: true, value: "completed" });
    expect(parseFieldInput("trip_status", "done").ok).toBe(false);
    expect(parseFieldInput("origin", "  Kaduna ")).toEqual({ ok: true, value: "Kaduna" });
    expect(parseFieldInput("origin", "x".repeat(201)).ok).toBe(false);
  });

  it("formats values the way the list shows them", () => {
    expect(formatFieldValue("odometer_end", 184434)).toBe(`184${THIN_SPACE}434`);
    expect(formatFieldValue("fuel_liters", 48)).toBe("48 L");
    expect(formatFieldValue("fuel_cost_ngn", 52000)).toBe(`₦52${THIN_SPACE}000`);
    expect(formatFieldValue("load_tonnage", 30)).toBe("30 t");
    expect(formatFieldValue("distance", 214)).toBe("214 km");
    expect(formatFieldValue("trip_status", "in_progress")).toBe("In progress");
    expect(formatFieldValue("origin", null)).toBeNull();
  });

  it("flags the values behind a failed check", () => {
    const results = parseValidation([
      { rule: "odometer_monotonic", passed: true, message: "Odometer moved forward, 1 → 2." },
      { rule: "fuel_efficiency", passed: false, severity: "medium", message: "Fuel use 28 km/L, expected 3–7." },
      { rule: "sane_values", passed: false, severity: "low", message: "Load 70 t is more than a truck carries (over 60 t). Fuel cost ₦3 000 000 is unusually high (over ₦2 000 000)." },
    ]);
    expect(results).toHaveLength(3);
    expect([...flaggedFields(results)].sort()).toEqual(["fuel_cost_ngn", "fuel_liters", "load_tonnage"]);
    expect(parseValidation(null)).toBeNull();
  });

  it("treats equal numbers and strings as unchanged", () => {
    expect(sameValue(48, 48)).toBe(true);
    expect(sameValue(48, "48")).toBe(true);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue("Kano", "Kaduna")).toBe(false);
  });
});
