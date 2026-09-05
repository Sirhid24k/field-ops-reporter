"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";
import { ProgressLine } from "./ProgressLine";

type SubmitButtonProps = Omit<ButtonProps, "loading" | "type" | "loadingLabel"> & {
  loadingLabel: string;
};

/**
 * A `Button` bound to the surrounding form's pending state. While the server
 * action runs it swaps its label and shows the progress line at the top of the
 * viewport, which is the app's only loading indicator.
 */
export function SubmitButton({ loadingLabel, children, ...rest }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <>
      <ProgressLine active={pending} />
      <Button type="submit" loading={pending} loadingLabel={loadingLabel} {...rest}>
        {children}
      </Button>
    </>
  );
}
