import { useId, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { FieldError, FieldHint, FieldLabel, controlClass, type FieldSize } from "./field";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  label?: string;
  hint?: string;
  error?: string;
  size?: FieldSize;
};

export function Select({ label, hint, error, size = "default", id, className, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className={className}>
      {label ? <FieldLabel htmlFor={selectId}>{label}</FieldLabel> : null}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
          className={cn(controlClass(size), "appearance-none pr-10")}
          {...rest}
        >
          {children}
        </select>
        {/* decorative chevron; the select itself carries the label */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 6l4.5 4.5L12.5 6" />
        </svg>
      </div>
      {error ? <FieldError id={errorId!}>{error}</FieldError> : null}
      {hint ? <FieldHint id={hintId!}>{hint}</FieldHint> : null}
    </div>
  );
}
