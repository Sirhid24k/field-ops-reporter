"use client";

import { useActionState } from "react";
import { sendSignInLink, type SignInState } from "@/app/auth/actions";
import { Input, SubmitButton } from "@/components/ui";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState<SignInState, FormData>(sendSignInLink, undefined);

  if (state?.sent) {
    return (
      <section aria-live="polite" className="mt-8">
        <p className="font-display text-heading font-bold">Sent to {state.sent}</p>
        <p className="mt-2 text-body-lg">
          Check your email and tap the link. You&rsquo;ll stay signed in on this device.
        </p>
      </section>
    );
  }

  return (
    <form action={action} noValidate className="mt-8 space-y-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Input
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@company.com"
        required
        defaultValue={state?.values?.email}
        error={state?.error}
      />
      <SubmitButton loadingLabel="Sending…" block>
        Send sign-in link
      </SubmitButton>
    </form>
  );
}
