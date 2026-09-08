"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";

export type ActiveToggleProps = {
  active: boolean;
  /** What is being switched, for assistive tech: "KTU 421 XA" / "Musa Abdullahi". */
  label: string;
  onToggle: (next: boolean) => Promise<{ ok: boolean; message?: string }>;
  disabled?: boolean;
  /** Why it is disabled, shown as a title. */
  reason?: string;
};

/**
 * The active switch in the Vehicles and People tables (design-brief §5 A4): a switch plus
 * the words "Active" / "Inactive", so the state is text as well as a position. Flips at
 * once and rolls back with a message if the save fails. Soft and reversible.
 */
export function ActiveToggle({ active, label, onToggle, disabled = false, reason }: ActiveToggleProps) {
  const [value, setValue] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flip() {
    const next = !value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await onToggle(next);
      if (!result.ok) {
        setValue(!next);
        setError(result.message ?? "Couldn't save the change. Try again.");
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={`${label} active`}
        onClick={flip}
        disabled={disabled || pending}
        title={disabled ? reason : undefined}
        className={cn("inline-flex min-h-10 items-center gap-2 rounded-control px-1", (disabled || pending) && "cursor-not-allowed opacity-60")}
      >
        <span aria-hidden="true" className={cn("relative inline-block h-6 w-10 rounded-[12px] border transition-colors", value ? "border-ink bg-ink" : "border-steel bg-transparent")}>
          <span className={cn("absolute top-0.5 size-[18px] rounded-[9px] transition-transform", value ? "translate-x-[18px] bg-paper" : "translate-x-0.5 bg-steel")} />
        </span>
        <span className={cn("font-display text-body font-semibold", value ? "text-ink" : "text-steel")}>{value ? "Active" : "Inactive"}</span>
      </button>
      {error ? (
        <span role="alert" className="text-caption text-flag">
          {error}
        </span>
      ) : null}
    </span>
  );
}
