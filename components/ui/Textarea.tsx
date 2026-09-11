import { useId, type ComponentPropsWithRef } from "react";
import { cn } from "@/lib/cn";
import { FieldError, FieldHint, FieldLabel, controlClass, type FieldSize } from "./field";

export type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  label?: string;
  hint?: string;
  error?: string;
  size?: FieldSize;
  /** Classes for the textarea element itself (`className` styles the wrapper), like Input's `inputClassName`. */
  textareaClassName?: string;
};

export function Textarea({ label, hint, error, size = "default", id, className, textareaClassName, ...rest }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const hintId = hint ? `${textareaId}-hint` : undefined;
  const errorId = error ? `${textareaId}-error` : undefined;

  return (
    <div className={className}>
      {label ? <FieldLabel htmlFor={textareaId}>{label}</FieldLabel> : null}
      <textarea
        id={textareaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className={cn(controlClass(size), "min-h-28 resize-y py-3 leading-6", textareaClassName)}
        {...rest}
      />
      {error ? <FieldError id={errorId!}>{error}</FieldError> : null}
      {hint ? <FieldHint id={hintId!}>{hint}</FieldHint> : null}
    </div>
  );
}
