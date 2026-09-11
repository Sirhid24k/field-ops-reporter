import { LETTERMARK_SHAPES, LETTERMARK_VIEWBOX } from "@/lib/lettermark";
import { cn } from "@/lib/cn";

export type LettermarkProps = {
  /** Rendered size in px (the box is square). */
  size?: number;
  /** Colour comes from `currentColor`, so `text-ink` and friends apply. */
  className?: string;
};

/** The F from the app icon, with no background: the same shapes as the favicon and the PWA icons. Decorative. */
export function Lettermark({ size = 48, className }: LettermarkProps) {
  return (
    <svg viewBox={LETTERMARK_VIEWBOX} width={size} height={size} aria-hidden="true" focusable="false" fill="currentColor" className={cn("shrink-0", className)}>
      {LETTERMARK_SHAPES.map((rect, index) => (
        <rect key={index} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      ))}
    </svg>
  );
}
