import { cn } from "@/lib/cn";

export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What is being switched, for assistive tech: "KTU 421 XA" / "Musa Abdullahi". The state comes from aria-checked. */
  label: string;
  /** The visible words beside the track. */
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
  /** Why it is disabled, shown as a title. */
  reason?: string;
  /** A save in flight: the control is inert but keeps its full colour. */
  pending?: boolean;
  className?: string;
};

/**
 * A switch with its state in words: a `<button role="switch">` holding a 44×24 track (`convoy` on,
 * `line` off, the 6 px control radius), an 18 px `paper` knob that slides 20 px, and the label to
 * the right in `steel`. Everything is laid out with flex and a fixed 8 px gap: the knob is
 * positioned from the track's own left edge, never from a static position, so nothing can land on
 * the words (the earlier toggle painted its knob over the first letter of "Active"). Every class
 * is a static string, so each one exists in the build. The 2 px ink focus ring is the global
 * `:focus-visible` rule; the knob's transition is off under prefers-reduced-motion.
 */
export function Switch({ checked, onChange, label, onLabel = "Active", offLabel = "Inactive", disabled = false, reason, pending = false, className }: SwitchProps) {
  const inert = disabled || pending;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      title={disabled ? reason : undefined}
      disabled={inert}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-control px-1 text-left",
        disabled && "cursor-not-allowed opacity-60",
        pending && "cursor-progress",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative block h-6 w-11 shrink-0 rounded-control border transition-colors duration-150 motion-reduce:transition-none",
          checked ? "border-convoy bg-convoy" : "border-line bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 block size-[18px] rounded-[4px] bg-paper shadow-[0_1px_2px_rgba(22,28,27,0.25)] transition-transform duration-150 motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
      <span className="font-display text-body font-semibold whitespace-nowrap text-steel">{checked ? onLabel : offLabel}</span>
    </button>
  );
}
