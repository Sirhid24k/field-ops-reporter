"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui";

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
 * The active switch in the Vehicles and People tables (design-brief §5 A4): the shared Switch
 * primitive with the words "Active" / "Inactive", so the state is text as well as a position.
 * Flips at once and rolls back with a message if the save fails. Soft and reversible.
 */
export function ActiveToggle({ active, label, onToggle, disabled = false, reason }: ActiveToggleProps) {
  const [value, setValue] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flip(next: boolean) {
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
      <Switch checked={value} onChange={flip} label={label} disabled={disabled} reason={reason} pending={pending} />
      {error ? (
        <span role="alert" className="text-caption text-flag">
          {error}
        </span>
      ) : null}
    </span>
  );
}
