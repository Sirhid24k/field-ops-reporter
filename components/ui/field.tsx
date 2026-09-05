import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Shared pieces for Input, Select and Textarea. Not a public primitive. */

export type FieldSize = "default" | "field";

const sizes: Record<FieldSize, string> = {
  default: "min-h-12",
  field: "min-h-14",
};

export function controlClass(size: FieldSize): string {
  return cn(
    "block w-full rounded-control border border-ink bg-paper px-3 text-body-lg text-ink",
    "placeholder:text-steel",
    "disabled:border-steel disabled:text-steel",
    "aria-[invalid=true]:border-flag",
    sizes[size],
  );
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-caption text-steel">
      {children}
    </label>
  );
}

export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-caption text-steel">
      {children}
    </p>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1.5 text-caption text-flag">
      {children}
    </p>
  );
}
