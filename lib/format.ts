/**
 * Number and time formatting shared by both surfaces.
 * Numbers in the UI are always set in tabular Barlow Condensed with
 * space-grouped thousands (design-brief §3): 184220 → "184 220".
 */

/** Narrow no-break space: groups digits without allowing a line break inside the number. */
export const THIN_SPACE = " ";

export function formatGrouped(
  value: number,
  { maximumFractionDigits = 0 }: { maximumFractionDigits?: number } = {},
): string {
  if (!Number.isFinite(value)) return "";
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(maximumFractionDigits);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  const trimmedFraction = fraction?.replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

/** "20:00" or "20:00:00" → "8:00 pm" (sentence-case, no dots, per the copy rules). */
export function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** First word of a full name, for the compact greeting in the field header. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
