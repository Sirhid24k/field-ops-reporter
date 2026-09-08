"use client";

import { useActionState } from "react";
import { Input, Select, SubmitButton } from "@/components/ui";
import type { FormState } from "@/lib/forms";
import { CUTOFF_OPTIONS, TIMEZONES } from "@/lib/options";
import { saveOrganization } from "./actions";

export function SettingsForm({ name, timezone, cutoff }: { name: string; timezone: string; cutoff: string }) {
  const [state, action] = useActionState<FormState, FormData>(saveOrganization, undefined);

  return (
    <form action={action} noValidate className="mt-8 max-w-[560px] space-y-5">
      <Input
        name="orgName"
        label="Business name"
        autoComplete="organization"
        required
        defaultValue={state?.values?.orgName ?? name}
        error={state?.fieldErrors?.orgName}
      />
      <Select name="timezone" label="Timezone" defaultValue={state?.values?.timezone ?? timezone} error={state?.fieldErrors?.timezone}>
        {TIMEZONES.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </Select>
      <Select
        name="cutoff"
        label="Report cutoff time"
        defaultValue={state?.values?.cutoff ?? cutoff}
        hint="Drivers are asked to report before this time each day."
        error={state?.fieldErrors?.cutoff}
      >
        {CUTOFF_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {state?.error ? (
        <p role="alert" className="border-l-4 border-flag pl-3 text-body text-flag">
          {state.error}
        </p>
      ) : null}
      <div className="flex items-center gap-4 pt-1">
        <SubmitButton loadingLabel="Saving…">Save</SubmitButton>
        {state?.done ? (
          <p role="status" className="text-body text-convoy">
            Saved
          </p>
        ) : null}
      </div>
    </form>
  );
}
