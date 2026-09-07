"use client";

import { useActionState, useState } from "react";
import { sendSignInCode, verifySignInCode, type SendCodeState, type VerifyCodeState } from "@/app/auth/actions";
import { CodeStep } from "@/components/auth/CodeStep";
import { Input, SubmitButton } from "@/components/ui";
import { OTP_LENGTH } from "@/lib/auth-otp";

export type SignInFormProps = {
  next?: string;
  /** The address a code was already sent to (link fallback), so the code step can open first. */
  initialEmail?: string;
  initialStep?: "email" | "code";
  /** Shown once, until the person sends a code from here. */
  notice?: string;
};

/** Two steps: email → code. The code step is shared with the invite flow. */
export function SignInForm({ next, initialEmail, initialStep = "email", notice }: SignInFormProps) {
  const [sendState, sendAction] = useActionState<SendCodeState, FormData>(sendSignInCode, undefined);
  const [verifyState, verifyAction] = useActionState<VerifyCodeState, FormData>(verifySignInCode, undefined);

  const sent = sendState?.step === "code" ? sendState : null;
  const [changing, setChanging] = useState(false);
  const [seenSentAt, setSeenSentAt] = useState<number | null>(null);
  if (sent && sent.sentAt !== seenSentAt) {
    // a new send always lands on the code step (and CodeStep restarts its throttle from the new id)
    setSeenSentAt(sent.sentAt);
    setChanging(false);
  }

  const codeEmail = changing ? undefined : (sent?.email ?? (initialStep === "code" ? initialEmail : undefined));
  const hidden: Record<string, string> = next ? { next } : {};

  if (codeEmail) {
    return (
      <CodeStep
        email={codeEmail}
        hidden={hidden}
        verifyAction={verifyAction}
        verifyState={verifyState}
        sendAction={sendAction}
        sendId={sent?.sentAt ?? null}
        onChangeEmail={() => setChanging(true)}
        notice={sent ? undefined : notice}
      />
    );
  }

  const emailError = sendState?.step === "email" ? sendState.error : undefined;
  const emailValue = sendState?.step === "email" ? sendState.values?.email : (sent?.email ?? initialEmail);

  return (
    <>
      <p className="mt-3 text-body-lg text-steel">
        Enter your email and we&rsquo;ll send you a sign-in code ({OTP_LENGTH} digits). First time here? Use your work
        email and you&rsquo;ll set up your business next.
      </p>
      {notice && !sent && !changing ? (
        <p role="alert" className="mt-6 border-l-4 border-flag pl-3 text-body text-flag">
          {notice}
        </p>
      ) : null}
      <form action={sendAction} noValidate className="mt-8 space-y-5">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Input
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          required
          defaultValue={emailValue}
          error={emailError}
        />
        <SubmitButton loadingLabel="Sending…" block>
          Send code
        </SubmitButton>
      </form>
    </>
  );
}
