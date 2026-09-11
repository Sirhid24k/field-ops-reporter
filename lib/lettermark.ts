/**
 * The app's lettermark: a condensed F drawn from three rectangles in a 100×100 box, so no
 * font is needed. One source for the PWA icons and the favicon (scripts/make-icons.mts),
 * and for the route-loading mark (components/ui/Lettermark.tsx). The F sits inside the 80%
 * safe zone so a maskable crop never clips it.
 */
export const LETTERMARK_VIEWBOX = "0 0 100 100";

export const LETTERMARK_SHAPES = [
  { x: 30, y: 22, w: 14, h: 56 }, // stem
  { x: 30, y: 22, w: 42, h: 13 }, // top bar
  { x: 30, y: 45, w: 33, h: 12 }, // middle bar
] as const;

/** The icon: the F in `ink` on a `background` square with `corner` radius (0 for a maskable icon). */
export function lettermarkSvg({ background, ink, corner }: { background: string; ink: string; corner: number }): string {
  const shapes = LETTERMARK_SHAPES.map((rect) => `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${ink}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LETTERMARK_VIEWBOX}"><rect width="100" height="100" rx="${corner}" fill="${background}"/>${shapes}</svg>`;
}
