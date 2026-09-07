"use client";

import { useActionState, useState } from "react";
import { CodeStep } from "@/components/auth/CodeStep";
import { Input, SubmitButton } from "@/components/ui";
import { OTP_LENGTH } from "@/lib/auth-otp";
import { sendJoinCode, verifyJoinCode, type JoinSendState, type JoinVerifyState } from "./actions";

export type JoinFormProps = {
  code: string;
  initialError?: string;
  /** From the pending cookies, so a failed link lands on the code step with the details kept. */
  initialEmail?: string;
  initialName?: string;
  initialStep?: "form" | "code";
  notice?: string;
};

/** F1 — two steps: name + email → code. Same code step as /signin, on the 56px driver surface. */
export function JoinForm({ code, initialError, initialEmail, initialName, initialStep = "form", notice }: JoinFormProps) {
  const [sendState, sendAction] = useActionState<JoinSendState, FormData>(sendJoinCode, undefined);
  const [verifyState, verifyAction] = useActionState<JoinVerifyState, FormData>(verifyJoinCode, undefined);

  const sent = sendState?.step === "code" ? sendState : null;
  const [changing, setChanging] = useState(false);
  const [seenSentAt, setSeenSentAt] = useState<number | null>(null);
  if (sent && sent.sentAt !== seenSentAt) {
    setSeenSentAt(sent.sentAt);
    setChanging(false);
  }

  const codeEmail = changing ? undefined : (sent?.email ?? (initialStep === "code" ? initialEmail : undefined));
  const fullName = sent?.fullName ?? initialName ?? "";

  if (codeEmail) {
    return (
      <CodeStep
        email={codeEmail}
        hidden={{ code, fullName }}
        verifyAction={verifyAction}
        verifyState={verifyState}
        sendAction={sendAction}
        sendId={sent?.sentAt ?? null}
        onChangeEmail={() => setChanging(true)}
        notice={sent ? undefined : notice}
        size="field"
        submitLabel="Sign in"
      />
    );
  }

  const form = sendState?.step === "form" ? sendState : undefined;
  const error = form?.error ?? initialError;
  const values = form?.values ?? { fullName: sent?.fullName ?? initialName ?? "", email: sent?.email ?? initialEmail ?? "" };

  return (
    <>
      {notice && !sent && !changing ? (
        <p role="alert" className="mt-6 border-l-4 border-flag pl-3 text-body text-flag">
          {notice}
        </p>
      ) : null}
      <form action={sendAction} noValidate className="mt-8 space-y-5">
        <input type="hidden" name="code" value={code} />
        <Input
          name="fullName"
          label="Your name"
          size="field"
          autoComplete="name"
          placeholder="Musa Abdullahi"
          required
          defaultValue={values.fullName}
          error={form?.fieldErrors?.fullName}
        />
        <Input
          name="email"
          type="email"
          label="Email"
          size="field"
          autoComplete="email"
          inputMode="email"
          placeholder="musa@example.com"
          required
          defaultValue={values.email}
          error={form?.fieldErrors?.email}
        />
        {error ? (
          <p role="alert" className="border-l-4 border-flag pl-3 text-body text-flag">
            {error}
          </p>
        ) : null}
        <SubmitButton size="field" loadingLabel="Sending…" block>
          Send code
        </SubmitButton>
        <p className="text-body-lg text-steel">
          We&rsquo;ll email you a sign-in code ({OTP_LENGTH} digits). Enter it here and you&rsquo;ll stay signed in on this
          phone.
        </p>
      </form>
    </>
  );
}
