import { describe, expect, it } from "vitest";
import { cutoffMinutes, digestDateFor, localClock, utcRangeForLocalDay } from "./digest";

describe("cutoffMinutes", () => {
  it("turns a Postgres time into minutes since midnight", () => {
    expect(cutoffMinutes("20:00:00")).toBe(1200);
    expect(cutoffMinutes("08:30")).toBe(510);
    expect(cutoffMinutes("")).toBe(0);
  });
});

describe("localClock", () => {
  it("gives the organisation's local date and minutes", () => {
    // Africa/Lagos is UTC+1 all year
    expect(localClock("Africa/Lagos", new Date("2026-09-07T19:35:00Z"))).toEqual({ date: "2026-09-07", minutes: 20 * 60 + 35 });
    expect(localClock("Africa/Lagos", new Date("2026-09-07T23:30:00Z"))).toEqual({ date: "2026-09-08", minutes: 30 });
    expect(localClock("UTC", new Date("2026-09-07T00:10:00Z"))).toEqual({ date: "2026-09-07", minutes: 10 });
  });
});

describe("digestDateFor", () => {
  const cutoff = cutoffMinutes("20:00:00");

  it("closes today once the cutoff has passed", () => {
    expect(digestDateFor({ date: "2026-09-07", minutes: 1235 }, cutoff)).toEqual({ date: "2026-09-07", target: "today" });
    expect(digestDateFor({ date: "2026-09-07", minutes: 1200 }, cutoff)).toEqual({ date: "2026-09-07", target: "today" });
  });

  it("closes yesterday when the run lands before the cutoff", () => {
    expect(digestDateFor({ date: "2026-09-07", minutes: 30 }, cutoff)).toEqual({ date: "2026-09-06", target: "yesterday" });
    expect(digestDateFor({ date: "2026-10-01", minutes: 30 }, cutoff)).toEqual({ date: "2026-09-30", target: "yesterday" });
    expect(digestDateFor({ date: "2027-01-01", minutes: 0 }, cutoff)).toEqual({ date: "2026-12-31", target: "yesterday" });
  });

  it("matches the Hobby schedule for the demo org: 19:30 UTC, even an hour late, is after a 20:00 Lagos cutoff", () => {
    for (const instant of ["2026-09-07T19:30:00Z", "2026-09-07T20:29:00Z"]) {
      expect(digestDateFor(localClock("Africa/Lagos", new Date(instant)), cutoff)).toEqual({ date: "2026-09-07", target: "today" });
    }
  });
});

describe("utcRangeForLocalDay", () => {
  it("brackets one local day in UTC", () => {
    expect(utcRangeForLocalDay("2026-09-07", "Africa/Lagos")).toEqual({ start: "2026-09-06T23:00:00.000Z", end: "2026-09-07T23:00:00.000Z" });
    expect(utcRangeForLocalDay("2026-09-07", "UTC")).toEqual({ start: "2026-09-07T00:00:00.000Z", end: "2026-09-08T00:00:00.000Z" });
  });
});
