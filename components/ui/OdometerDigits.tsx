import { cn } from "@/lib/cn";
import { formatGrouped } from "@/lib/format";

export type OdometerSize = "hero" | "board";

export type OdometerDigitsProps = {
  /** A number is space-grouped for you (184220 → 184 220); a string is shown as given (e.g. a timer "0:14"). */
  value: number | string;
  /** hero = 44px (report km, timers); board = 64px (today board counts). */
  size?: OdometerSize;
  /** Shown after the strip in a smaller condensed face, e.g. "km", "L". */
  unit?: string;
  maximumFractionDigits?: number;
  className?: string;
};

const strips: Record<OdometerSize, string> = {
  hero: "px-[0.16em] py-1 text-hero",
  board: "px-[0.16em] py-[5px] text-board",
};

const units: Record<OdometerSize, string> = {
  hero: "text-heading",
  board: "text-title",
};

/**
 * The signature element: tall condensed tabular digits sitting on an ink-6% strip,
 * like a mechanical odometer drum. Use it wherever a number is large.
 */
export function OdometerDigits({
  value,
  size = "hero",
  unit,
  maximumFractionDigits = 0,
  className,
}: OdometerDigitsProps) {
  const digits = typeof value === "number" ? formatGrouped(value, { maximumFractionDigits }) : value;
  const spoken = `${typeof value === "number" ? value : value}${unit ? ` ${unit}` : ""}`;

  return (
    <span className={cn("inline-flex items-baseline gap-[0.3em]", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block rounded-none bg-ink/6 font-display font-bold tracking-[0.02em] tabular",
          strips[size],
        )}
      >
        {digits}
      </span>
      {unit ? (
        <span aria-hidden="true" className={cn("font-display font-semibold text-steel", units[size])}>
          {unit}
        </span>
      ) : null}
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
