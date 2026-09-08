import { describe, expect, it } from "vitest";
import { markdownToPlainText, parseInline, parseMarkdown } from "./markdown";

const SAMPLE = [
  "# Saturday 5 Sep",
  "",
  "## Needs your attention",
  "* KTU 421 XA, Musa Abdullahi: Fuel use 1 km/L, expected",
  "  2.7–6.3 (distance measured from the last approved",
  "  odometer).",
  "",
  "## Did not report",
  "Every vehicle reported.",
  "",
  "## The day's numbers",
  "Reported 1 of 1 vehicles, 2 alerts.",
  "300 km driven and 300 L of fuel",
  "- KTU 421 XA, Musa Abdullahi: Kaduna → Zaria, **300 km**",
].join("\n");

describe("digest markdown", () => {
  it("parses headings, wrapped bullets and paragraphs", () => {
    expect(parseMarkdown(SAMPLE)).toEqual([
      { type: "heading", level: 1, text: "Saturday 5 Sep" },
      { type: "heading", level: 2, text: "Needs your attention" },
      { type: "list", items: ["KTU 421 XA, Musa Abdullahi: Fuel use 1 km/L, expected 2.7–6.3 (distance measured from the last approved odometer)."] },
      { type: "heading", level: 2, text: "Did not report" },
      { type: "paragraph", text: "Every vehicle reported." },
      { type: "heading", level: 2, text: "The day's numbers" },
      { type: "paragraph", text: "Reported 1 of 1 vehicles, 2 alerts. 300 km driven and 300 L of fuel" },
      { type: "list", items: ["KTU 421 XA, Musa Abdullahi: Kaduna → Zaria, **300 km**"] },
    ]);
  });

  it("never treats text as markup", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });

  it("splits bold spans", () => {
    expect(parseInline("Kaduna → Zaria, **300 km** driven")).toEqual([
      { bold: false, text: "Kaduna → Zaria, " },
      { bold: true, text: "300 km" },
      { bold: false, text: " driven" },
    ]);
    expect(parseInline("no bold")).toEqual([{ bold: false, text: "no bold" }]);
  });

  it("writes plain text for WhatsApp", () => {
    expect(markdownToPlainText(SAMPLE)).toBe(
      [
        "Saturday 5 Sep",
        "",
        "Needs your attention",
        "",
        "• KTU 421 XA, Musa Abdullahi: Fuel use 1 km/L, expected 2.7–6.3 (distance measured from the last approved odometer).",
        "",
        "Did not report",
        "",
        "Every vehicle reported.",
        "",
        "The day's numbers",
        "",
        "Reported 1 of 1 vehicles, 2 alerts. 300 km driven and 300 L of fuel",
        "",
        "• KTU 421 XA, Musa Abdullahi: Kaduna → Zaria, 300 km",
      ].join("\n"),
    );
  });
});
