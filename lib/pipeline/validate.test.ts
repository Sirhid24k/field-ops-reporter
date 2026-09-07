import { describe, expect, it } from "vitest";
import { formatGrouped } from "@/lib/format";
import {
  incidentSeverity,
  missingReportAlert,
  validateReport,
  type ValidationInput,
  type ValidationResult,
  type ValidationRule,
} from "./validate";

const base: ValidationInput = {
  odometerStart: null,
  odometerEnd: null,
  fuelLiters: null,
  fuelCostNgn: null,
  loadTonnage: null,
  incidents: [],
  lastOdometer: null,
  daysSinceLastOdometer: null,
  fuelBaselineKmPerL: null,
  hasDuplicate: false,
};

function rule(results: ValidationResult[], name: ValidationRule): ValidationResult {
  const found = results.find((result) => result.rule === name);
  if (!found) throw new Error(`no result for ${name}`);
  return found;
}

describe("odometer_monotonic", () => {
  it("flags an end reading below the last approved reading as high", () => {
    const verdict = validateReport({ ...base, odometerEnd: 184_100, lastOdometer: 184_220 });
    const result = rule(verdict.results, "odometer_monotonic");
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("high");
    expect(result.message).toBe(`Odometer went backwards: ${formatGrouped(184_100)} is below the last approved reading ${formatGrouped(184_220)}.`);
    expect(verdict.alerts).toEqual([{ type: "odometer_backwards", severity: "high", message: result.message }]);
  });

  it("flags an end reading below the start reading as high", () => {
    const verdict = validateReport({ ...base, odometerStart: 184_220, odometerEnd: 184_000 });
    const result = rule(verdict.results, "odometer_monotonic");
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("high");
    expect(result.message).toContain("below the start reading");
  });

  it("flags a jump of more than 1,500 km in a day as medium", () => {
    const verdict = validateReport({ ...base, odometerStart: 184_220, odometerEnd: 186_520 });
    const result = rule(verdict.results, "odometer_monotonic");
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("medium");
    expect(result.message).toBe(`Odometer jumped ${formatGrouped(2_300)} km in a day, from ${formatGrouped(184_220)} to ${formatGrouped(186_520)}.`);
    expect(verdict.alerts.map((alert) => alert.type)).toEqual(["odometer_jump"]);
  });

  it("measures the jump from the last approved reading when only one reading was given", () => {
    const flagged = validateReport({ ...base, odometerEnd: 186_000, lastOdometer: 184_220, daysSinceLastOdometer: 1 });
    expect(rule(flagged.results, "odometer_monotonic").passed).toBe(false);

    const spreadOverDays = validateReport({ ...base, odometerEnd: 186_000, lastOdometer: 184_220, daysSinceLastOdometer: 3 });
    expect(rule(spreadOverDays.results, "odometer_monotonic").passed).toBe(true);
  });

  it("passes a forward move and says so", () => {
    const verdict = validateReport({ ...base, odometerEnd: 184_434, lastOdometer: 184_220 });
    const result = rule(verdict.results, "odometer_monotonic");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.message).toBe(`Odometer moved forward, ${formatGrouped(184_220)} → ${formatGrouped(184_434)}.`);
    expect(verdict.alerts).toEqual([]);
  });

  it("skips when there is no odometer reading", () => {
    const result = rule(validateReport(base).results, "odometer_monotonic");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe("fuel_efficiency", () => {
  it("flags fuel use far above the baseline", () => {
    const verdict = validateReport({ ...base, odometerStart: 184_220, odometerEnd: 185_620, fuelLiters: 50, fuelBaselineKmPerL: 5 });
    const result = rule(verdict.results, "fuel_efficiency");
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("medium");
    expect(result.message).toBe("Fuel use 28 km/L, expected 3–7.");
    expect(verdict.alerts.map((alert) => alert.type)).toEqual(["fuel_outlier"]);
  });

  it("flags fuel use far below the baseline", () => {
    const verdict = validateReport({ ...base, odometerStart: 184_220, odometerEnd: 184_320, fuelLiters: 100, fuelBaselineKmPerL: 5 });
    const result = rule(verdict.results, "fuel_efficiency");
    expect(result.passed).toBe(false);
    expect(result.message).toBe("Fuel use 1 km/L, expected 3–7.");
  });

  it("passes fuel use inside the ±40% band", () => {
    const verdict = validateReport({ ...base, odometerStart: 184_220, odometerEnd: 184_434, fuelLiters: 48, fuelBaselineKmPerL: 4.5 });
    const result = rule(verdict.results, "fuel_efficiency");
    expect(result.passed).toBe(true);
    expect(result.message).toBe("Fuel use 4.5 km/L, within the expected 2.7–6.3.");
    expect(verdict.distanceKm).toBe(214);
  });

  it("uses the last approved reading as the start when the driver gave one number", () => {
    const verdict = validateReport({ ...base, odometerEnd: 184_434, lastOdometer: 184_220, fuelLiters: 48, fuelBaselineKmPerL: 4.5 });
    const result = rule(verdict.results, "fuel_efficiency");
    expect(result.passed).toBe(true);
    expect(result.message).toContain("(distance measured from the last approved odometer)");
    expect(verdict.distanceKm).toBe(214);
  });

  it("skips when the baseline is null", () => {
    const result = rule(validateReport({ ...base, odometerStart: 184_220, odometerEnd: 185_620, fuelLiters: 50 }).results, "fuel_efficiency");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.message).toBe("No fuel baseline for this organisation yet.");
  });

  it("skips when fuel is null", () => {
    const result = rule(validateReport({ ...base, odometerStart: 184_220, odometerEnd: 185_620, fuelBaselineKmPerL: 5 }).results, "fuel_efficiency");
    expect(result.skipped).toBe(true);
    expect(result.message).toBe("No fuel figure to check.");
  });

  it("skips when there is no distance to compare with", () => {
    const result = rule(validateReport({ ...base, odometerEnd: 185_620, fuelLiters: 50, fuelBaselineKmPerL: 5 }).results, "fuel_efficiency");
    expect(result.skipped).toBe(true);
    expect(result.message).toBe("No distance to check fuel use against.");
  });
});

describe("sane_values", () => {
  it("passes ordinary figures", () => {
    const result = rule(validateReport({ ...base, loadTonnage: 30, fuelLiters: 48, fuelCostNgn: 52_000 }).results, "sane_values");
    expect(result.passed).toBe(true);
  });

  it("flags absurd tonnage, litres and cost together as one low alert", () => {
    const verdict = validateReport({ ...base, loadTonnage: 80, fuelLiters: 1_200, fuelCostNgn: 3_000_000 });
    const result = rule(verdict.results, "sane_values");
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("low");
    expect(result.message).toContain("Load 80 t is more than a truck carries");
    expect(result.message).toContain(`Fuel ${formatGrouped(1_200)} L is more than a tank holds`);
    expect(result.message).toContain(`Fuel cost ₦${formatGrouped(3_000_000)} is unusually high`);
    expect(verdict.alerts.filter((alert) => alert.type === "implausible_value")).toHaveLength(1);
  });

  it("flags negative figures", () => {
    const result = rule(validateReport({ ...base, fuelLiters: -5 }).results, "sane_values");
    expect(result.passed).toBe(false);
    expect(result.message).toBe("Fuel cannot be negative (-5).");
  });
});

describe("duplicate", () => {
  it("flags a second ready report for the same vehicle and date", () => {
    const verdict = validateReport({ ...base, hasDuplicate: true });
    const result = rule(verdict.results, "duplicate");
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("medium");
    expect(verdict.alerts).toEqual([{ type: "duplicate", severity: "medium", message: "Another report for this vehicle on this date was already sent." }]);
  });

  it("passes when there is no other report", () => {
    expect(rule(validateReport(base).results, "duplicate").passed).toBe(true);
  });
});

describe("incident", () => {
  it("raises accidents and thefts to at least medium", () => {
    expect(incidentSeverity({ type: "accident", severity: "low", description: "" })).toBe("medium");
    expect(incidentSeverity({ type: "theft", severity: "low", description: "" })).toBe("medium");
    expect(incidentSeverity({ type: "theft", severity: "high", description: "" })).toBe("high");
    expect(incidentSeverity({ type: "breakdown", severity: "low", description: "" })).toBe("low");
  });

  it("creates one alert per incident with a human sentence", () => {
    const verdict = validateReport({
      ...base,
      incidents: [
        { type: "breakdown", severity: "low", description: "gearbox failed near Kaduna" },
        { type: "accident", severity: "low", description: "Scraped a bus at the park." },
      ],
    });
    const result = rule(verdict.results, "incident");
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("medium");
    expect(verdict.alerts).toEqual([
      { type: "incident", severity: "low", message: "Breakdown reported: gearbox failed near Kaduna." },
      { type: "incident", severity: "medium", message: "Accident reported: Scraped a bus at the park." },
    ]);
  });

  it("passes with no incidents", () => {
    const result = rule(validateReport(base).results, "incident");
    expect(result.passed).toBe(true);
    expect(result.message).toBe("No incidents reported.");
  });
});

describe("missing_report", () => {
  it("writes the alert the digest cron inserts", () => {
    expect(missingReportAlert("KTU 421 XA", "Sun 7 Sep")).toEqual({
      type: "missing_report",
      severity: "low",
      message: "No report from KTU 421 XA on Sun 7 Sep.",
    });
  });
});

describe("validateReport", () => {
  it("returns all five report rules in order", () => {
    expect(validateReport(base).results.map((result) => result.rule)).toEqual([
      "odometer_monotonic",
      "fuel_efficiency",
      "sane_values",
      "duplicate",
      "incident",
    ]);
  });
});
