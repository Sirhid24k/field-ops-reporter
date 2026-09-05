import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { FieldError, FieldHint, FieldLabel, controlClass, type FieldSize } from "./field";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: string;
  hint?: string;
  /** Shown under the control in flag; also marks the control invalid. */
  error?: string;
  size?: FieldSize;
  /** Extra classes on the control itself (the wrapper takes `className`), e.g. condensed digits for a plate. */
  inputClassName?: string;
};

export function Input({ label, hint, error, size = "default", id, className, inputClassName, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={className}>
      {label ? <FieldLabel htmlFor={inputId}>{label}</FieldLabel> : null}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className={cn(controlClass(size), "py-0", inputClassName)}
        {...rest}
      />
      {error ? <FieldError id={errorId!}>{error}</FieldError> : null}
      {hint ? <FieldHint id={hintId!}>{hint}</FieldHint> : null}
    </div>
  );
}
