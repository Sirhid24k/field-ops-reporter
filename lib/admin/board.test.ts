import { describe, expect, it } from "vitest";
import { chipForRow, flagsFromValidation, pickReport, routeOf, rowSummaryLine, sortRows } from "./board";
import { shortName } from "@/lib/format";

describe("board rows", () => {
  it("sorts alerts, then needs answer, then not reported, then the rest, plates alphabetical inside a group", () => {
    const rows = [
      { plate: "KTU 421 XA", status: "reviewed" as const, openAlerts: 0 },
      { plate: "GWA 330 XY", status: null, openAlerts: 0 },
      { plate: "KJA 118 BC", status: "needs_clarification" as const, openAlerts: 0 },
      { plate: "ABJ 902 KW", status: "ready" as const, openAlerts: 1 },
      { plate: "AAA 111 AA", status: "ready" as const, openAlerts: 0 },
    ];
    expect(sortRows(rows).map((row) => row.plate)).toEqual(["ABJ 902 KW", "KJA 118 BC", "GWA 330 XY", "AAA 111 AA", "KTU 421 XA"]);
  });

  it("flags the figure that failed a check", () => {
    expect(
      flagsFromValidation([
        { rule: "odometer_monotonic", passed: true, message: "Odometer moved forward, 1 → 2." },
        { rule: "fuel_efficiency", passed: false, message: "Fuel use 28 km/L, expected 3–7.", severity: "medium" },
      ]),
    ).toEqual({ km: false, liters: true });
    expect(flagsFromValidation([{ rule: "odometer_monotonic", passed: false, message: "Odometer went backwards…" }])).toEqual({ km: true, liters: false });
    expect(flagsFromValidation([{ rule: "sane_values", passed: false, message: "Fuel 1 200 L is more than a tank holds (over 1 000 L)." }])).toEqual({ km: false, liters: true });
    expect(flagsFromValidation([{ rule: "sane_values", passed: false, message: "Fuel cost ₦3 000 000 is unusually high (over ₦2 000 000)." }])).toEqual({ km: false, liters: false });
    expect(flagsFromValidation(null)).toEqual({ km: false, liters: false });
  });

  it("picks the report that needs the most attention for a vehicle", () => {
    const newest = { id: "c", status: "ready" as const, openAlerts: 0, submitted_at: "2026-09-08T12:00:00Z" };
    const question = { id: "b", status: "needs_clarification" as const, openAlerts: 0, submitted_at: "2026-09-08T10:00:00Z" };
    const flagged = { id: "a", status: "ready" as const, openAlerts: 2, submitted_at: "2026-09-08T08:00:00Z" };
    expect(pickReport([newest, question, flagged])?.id).toBe("a");
    expect(pickReport([newest, question])?.id).toBe("b");
    expect(pickReport([newest, { ...newest, id: "d", submitted_at: "2026-09-08T09:00:00Z" }])?.id).toBe("c");
    expect(pickReport([])).toBeNull();
  });

  it("shows the alert count over the status, and Processing for a queued report", () => {
    expect(chipForRow({ status: "reviewed", openAlerts: 1 })).toEqual({ kind: "chip", status: "alert", count: 1 });
    expect(chipForRow({ status: "queued", openAlerts: 0 })).toEqual({ kind: "chip", status: "processing" });
    expect(chipForRow({ status: "ready", openAlerts: 0 })).toEqual({ kind: "chip", status: "sent" });
    expect(chipForRow({ status: null, openAlerts: 0 })).toEqual({ kind: "chip", status: "not_reported" });
    expect(chipForRow({ status: "failed", openAlerts: 0 })).toEqual({ kind: "text", label: "Not processed" });
  });

  it("renders a route with one end missing as an arrow, not a dash", () => {
    expect(routeOf("Kaduna", "Kano")).toBe("Kaduna → Kano");
    expect(routeOf(null, "Alpana, Kogi State")).toBe("→ Alpana, Kogi State");
    expect(routeOf("Kaduna", null)).toBe("Kaduna →");
    expect(routeOf(null, null)).toBeNull();
    expect(routeOf("  ", "Kano")).toBe("→ Kano");
  });

  it("writes the phone line and short names", () => {
    const km = (value: number) => String(value);
    expect(rowSummaryLine({ driver: "Yusuf Bello", route: "Lokoja → Minna", km: 611 }, km)).toBe("Yusuf, Lokoja → Minna");
    expect(rowSummaryLine({ driver: "Musa Abdullahi", route: null, km: 214 }, km)).toBe("Musa, 214 km");
    expect(rowSummaryLine({ driver: "Sani", route: null, km: null }, km)).toBe("Sani");
    expect(rowSummaryLine({ driver: null, route: null, km: null }, km)).toBe("");
    expect(shortName("Musa Abdullahi")).toBe("Musa A.");
    expect(shortName("Sani")).toBe("Sani");
  });
});
