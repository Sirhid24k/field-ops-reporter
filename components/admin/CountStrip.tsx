import { OdometerDigits } from "@/components/ui";
import { cn } from "@/lib/cn";

export type CountItem = {
  label: string;
  /** A count is zero-padded to two digits like an odometer drum ("08"); totals come as numbers. */
  value: number | string;
  unit?: string;
  maximumFractionDigits?: number;
  /** flag for alerts, hazard for open questions; only when the number is above zero. */
  tone?: "flag" | "hazard";
};

const tones = { flag: "text-flag", hazard: "text-hazard-ink" } as const;

/** Two digits, like an odometer drum: 8 → "08". */
export function padCount(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The count strip: board digits on odometer strips, the hero of A1 (wireframe 1j). On the
 * digest it is the same strip one size down. Below 900px the board size drops to hero.
 */
export function CountStrip({ items, size = "board" }: { items: CountItem[]; size?: "board" | "hero" }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-5", size === "board" ? "grid-cols-2 min-[900px]:grid-cols-4" : "grid-cols-2 min-[900px]:grid-cols-5")}>
      {items.map((item) => {
        const tone = item.tone && (typeof item.value === "number" ? item.value > 0 : item.value !== "00") ? tones[item.tone] : undefined;
        return (
          <div key={item.label} className="min-w-0">
            <dt className="text-caption text-steel">{item.label}</dt>
            <dd className={cn("mt-1.5", tone)}>
              {size === "board" ? (
                <>
                  <span className="hidden min-[900px]:inline-flex">
                    <OdometerDigits value={item.value} size="board" unit={item.unit} maximumFractionDigits={item.maximumFractionDigits} />
                  </span>
                  <span className="inline-flex min-[900px]:hidden">
                    <OdometerDigits value={item.value} size="hero" unit={item.unit} maximumFractionDigits={item.maximumFractionDigits} />
                  </span>
                </>
              ) : (
                <OdometerDigits value={item.value} size="hero" unit={item.unit} maximumFractionDigits={item.maximumFractionDigits} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
