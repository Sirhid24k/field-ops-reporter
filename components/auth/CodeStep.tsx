"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, SubmitButton } from "@/components/ui";
import { isCompleteOtpCode, normalizeOtpCode, OTP_LENGTH, RESEND_SECONDS } from "@/lib/auth-otp";

export type VerifyState = { error?: string; attempt: number } | undefined;

export type CodeStepProps = {
  email: string;
  /** Carried in both forms (e.g. `next`, or the invite code and name). */
  hidden?: Record<string, string>;
  verifyAction: (formData: FormData) => void;
  verifyState: VerifyState;
  /** The send action again; "Send a new code" posts the same email to it. */
  sendAction: (formData: FormData) => void;
  /** Identity of the last send from this device (the action's timestamp); null when the person arrived from a link. */
  sendId: number | null;
  onChangeEmail: () => void;
  notice?: string;
  /** `field` = the 56px driver surface (F1). */
  size?: "default" | "field";
  submitLabel?: string;
};

/**
 * Seconds left on the resend throttle. `sendId` identifies the latest send (null when no
 * code was sent from this device); each new id restarts the 60 s from the client clock.
 */
function useCountdown(sendId: number | null): number {
  const [seenId, setSeenId] = useState(sendId);
  const [remaining, setRemaining] = useState(sendId === null ? 0 : RESEND_SECONDS);
  if (sendId !== seenId) {
    setSeenId(sendId);
    setRemaining(sendId === null ? 0 : RESEND_SECONDS);
  }
  useEffect(() => {
    if (sendId === null) return;
    const until = Date.now() + RESEND_SECONDS * 1000;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [sendId]);
  return remaining;
}

function ResendButton({ remaining }: { remaining: number }) {
  const { pending } = useFormStatus();
  const throttled = remaining > 0;
  return (
    <Button type="submit" variant="text" disabled={throttled || pending} aria-live="polite">
      {pending ? "Sending…" : throttled ? `Send a new code in ${remaining}s` : "Send a new code"}
    </Button>
  );
}

/**
 * Step 2 of signing in: "Enter the 6-digit code we sent to …", one one-time-code input that
 * submits itself on the sixth digit, a throttled "Send a new code", and a way back to the
 * email step. Shared by /signin and /join/[code].
 */
export function CodeStep({
  email,
  hidden = {},
  verifyAction,
  verifyState,
  sendAction,
  sendId,
  onChangeEmail,
  notice,
  size = "default",
  submitLabel = "Sign in",
}: CodeStepProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState("");

  // a failed check clears the box so the next code is typed fresh (the input is keyed by attempt too)
  const attempt = verifyState?.attempt ?? 0;
  const [seenAttempt, setSeenAttempt] = useState(attempt);
  if (attempt !== seenAttempt) {
    setSeenAttempt(attempt);
    setCode("");
  }

  const remaining = useCountdown(sendId);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digits = normalizeOtpCode(event.target.value);
    setCode(digits);
    if (isCompleteOtpCode(digits)) setTimeout(() => formRef.current?.requestSubmit(), 0);
  };

  const hiddenInputs = Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);

  return (
    <section aria-live="polite" className="mt-8">
      <p className="text-body-lg">
        Enter the {OTP_LENGTH}-digit code we sent to <strong className="font-semibold">{email}</strong>.
      </p>
      {notice ? (
        <p role="alert" className="mt-4 border-l-4 border-flag pl-3 text-body text-flag">
          {notice}
        </p>
      ) : null}

      <form ref={formRef} action={verifyAction} noValidate className="mt-6 space-y-5">
        {hiddenInputs}
        <input type="hidden" name="email" value={email} />
        <Input
          key={attempt}
          name="token"
          label="Code"
          size={size}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={OTP_LENGTH}
          autoFocus
          value={code}
          onChange={onChange}
          error={verifyState?.error}
          inputClassName="font-display text-heading font-bold tabular tracking-[0.3em]"
        />
        <SubmitButton size={size} loadingLabel="Checking…" block>
          {submitLabel}
        </SubmitButton>
      </form>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <form action={sendAction}>
          {hiddenInputs}
          <input type="hidden" name="email" value={email} />
          <ResendButton remaining={remaining} />
        </form>
        <Button type="button" variant="text" onClick={onChangeEmail}>
          Use a different email
        </Button>
      </div>
    </section>
  );
}
