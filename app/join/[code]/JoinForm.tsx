"use client";

import { useActionState } from "react";
import { Input, SubmitButton } from "@/components/ui";
import { sendJoinLink, type JoinState } from "./actions";

export function JoinForm({ code, initialError }: { code: string; initialError?: string }) {
  const [state, action] = useActionState<JoinState, FormData>(sendJoinLink, undefined);

  if (state?.sent) {
    return (
      <section aria-live="polite" className="mt-8">
        <p className="font-display text-heading font-bold">Sent to {state.sent}</p>
        <p className="mt-2 text-body-lg">
          Check your email and tap the link. You&rsquo;ll stay signed in on this phone.
        </p>
      </section>
    );
  }

  const error = state?.error ?? initialError;

  return (
    <form action={action} noValidate className="mt-8 space-y-5">
      <input type="hidden" name="code" value={code} />
      <Input
        name="fullName"
        label="Your name"
        size="field"
        autoComplete="name"
        placeholder="Musa Abdullahi"
        required
        defaultValue={state?.values?.fullName}
        error={state?.fieldErrors?.fullName}
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
        defaultValue={state?.values?.email}
        error={state?.fieldErrors?.email}
      />
      {error ? (
        <p role="alert" className="border-l-4 border-flag pl-3 text-body text-flag">
          {error}
        </p>
      ) : null}
      <SubmitButton size="field" loadingLabel="Sending…" block>
        Send sign-in link
      </SubmitButton>
      <p className="text-body-lg text-steel">
        Check your email and tap the link. You&rsquo;ll stay signed in on this phone.
      </p>
    </form>
  );
}
