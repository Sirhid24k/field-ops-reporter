import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "text";
export type ButtonSize = "default" | "field";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  /** `field` is the 56px minimum tap target for the PWA. */
  size?: ButtonSize;
  /** Stretch to the container width (field primary actions always do). */
  block?: boolean;
  /**
   * While loading the label is swapped for `loadingLabel`, following the copy
   * rule "Send report" → "Sending…". Always pass both together.
   */
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
};

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control border font-display font-semibold transition-colors duration-150";

const sizes: Record<ButtonSize, string> = {
  default: "min-h-12 px-5 text-body-lg",
  field: "min-h-14 px-6 text-heading",
};

const variants: Record<ButtonVariant, { rest: string; disabled: string }> = {
  primary: {
    rest: "border-ink bg-ink text-paper hover:bg-ink/90",
    disabled: "border-steel bg-steel text-paper",
  },
  secondary: {
    rest: "border-ink bg-transparent text-ink hover:bg-ink/6",
    disabled: "border-steel bg-transparent text-steel",
  },
  destructive: {
    rest: "border-flag bg-transparent text-flag hover:bg-flag/12",
    disabled: "border-steel bg-transparent text-steel",
  },
  text: {
    rest: "border-transparent bg-transparent px-2 text-ink underline decoration-1 underline-offset-4 hover:decoration-2",
    disabled: "border-transparent bg-transparent px-2 text-steel underline decoration-1 underline-offset-4",
  },
};

/** Button styling on its own, for links that must look like buttons (e.g. "Go to Today"). */
export function buttonClassName({
  variant = "primary",
  size = "default",
  block = false,
  disabled = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  disabled?: boolean;
  className?: string;
} = {}): string {
  return cn(
    base,
    sizes[size],
    disabled ? variants[variant].disabled : variants[variant].rest,
    disabled && "cursor-not-allowed",
    block && "w-full",
    className,
  );
}

export function Button({
  variant = "primary",
  size = "default",
  block = false,
  loading = false,
  loadingLabel,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const inactive = Boolean(disabled) && !loading;
  const label = loading ? (loadingLabel ?? children) : children;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        buttonClassName({ variant, size, block, disabled: inactive }),
        loading && "cursor-progress",
        className,
      )}
      {...rest}
    >
      {label}
    </button>
  );
}
