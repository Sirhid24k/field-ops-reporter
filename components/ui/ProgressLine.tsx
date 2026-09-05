export type ProgressLineProps = {
  active?: boolean;
  /** Read by assistive tech; the line itself carries no text. */
  label?: string;
};

/**
 * A 2px indeterminate ink line fixed to the top of the viewport.
 * It is the only loading indicator in the app: no spinners, no skeleton grids.
 * With reduced motion the line is shown static and full width.
 */
export function ProgressLine({ active = true, label = "Loading" }: ProgressLineProps) {
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label={label}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div className="h-full w-2/5 animate-progress-line bg-ink motion-reduce:w-full" />
    </div>
  );
}
