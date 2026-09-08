import { describe, expect, it } from "vitest";
import { csvCell, csvLine } from "./csv";

describe("csv", () => {
  it("quotes only what needs quoting", () => {
    expect(csvCell("Kaduna")).toBe("Kaduna");
    expect(csvCell("Kaduna, north")).toBe('"Kaduna, north"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(214)).toBe("214");
    expect(csvCell(48.5)).toBe("48.5");
  });

  it("defuses formulas", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("-cmd")).toBe("'-cmd");
  });

  it("writes CRLF lines", () => {
    expect(csvLine(["2026-09-02", "KTU 421 XA", 214, null])).toBe("2026-09-02,KTU 421 XA,214,\r\n");
  });
});
