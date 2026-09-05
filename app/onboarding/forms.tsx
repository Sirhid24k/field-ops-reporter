"use client";

import { useActionState } from "react";
import { Input, Select, SubmitButton } from "@/components/ui";
import type { FormState } from "@/lib/forms";
import { CUTOFF_OPTIONS, DEFAULT_CUTOFF, DEFAULT_TIMEZONE, TIMEZONES } from "@/lib/options";
import { addVehicle, createOrganization } from "./actions";

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="border-l-4 border-flag pl-3 text-body text-flag">
      {message}
    </p>
  );
}

export function CreateOrgForm() {
  const [state, action] = useActionState<FormState, FormData>(createOrganization, undefined);

  return (
    <form action={action} noValidate className="mt-7 space-y-5">
      <Input
        name="fullName"
        label="Your name"
        autoComplete="name"
        placeholder="Amaka Obi"
        required
        defaultValue={state?.values?.fullName}
        error={state?.fieldErrors?.fullName}
      />
      <Input
        name="orgName"
        label="Business name"
        autoComplete="organization"
        placeholder="Demo Haulage Ltd"
        required
        defaultValue={state?.values?.orgName}
        error={state?.fieldErrors?.orgName}
      />
      <Select
        name="timezone"
        label="Timezone"
        defaultValue={state?.values?.timezone || DEFAULT_TIMEZONE}
        error={state?.fieldErrors?.timezone}
      >
        {TIMEZONES.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </Select>
      <Select
        name="cutoff"
        label="Report cutoff time"
        defaultValue={state?.values?.cutoff || DEFAULT_CUTOFF}
        hint="Drivers are asked to report before this time each day."
        error={state?.fieldErrors?.cutoff}
      >
        {CUTOFF_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <FormError message={state?.error} />
      <SubmitButton loadingLabel="Saving…" block className="mt-3">
        Continue
      </SubmitButton>
    </form>
  );
}

export function AddVehicleForm() {
  const [state, action] = useActionState<FormState, FormData>(addVehicle, undefined);

  return (
    <form action={action} noValidate className="mt-7 space-y-5">
      <Input
        name="plate"
        label="Plate"
        placeholder="KTU 421 XA"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        required
        inputClassName="font-display font-bold tabular uppercase"
        defaultValue={state?.values?.plate}
        error={state?.fieldErrors?.plate}
      />
      <Input
        name="label"
        label="Label"
        placeholder="Sinotruk tipper"
        defaultValue={state?.values?.label}
        error={state?.fieldErrors?.label}
      />
      <Input
        name="odometer"
        label="Current odometer"
        placeholder="184 220"
        inputMode="numeric"
        autoComplete="off"
        inputClassName="font-display font-bold tabular"
        hint="Kilometres on the dashboard right now. You can add it later."
        defaultValue={state?.values?.odometer}
        error={state?.fieldErrors?.odometer}
      />
      <FormError message={state?.error} />
      <SubmitButton loadingLabel="Saving…" block className="mt-3">
        Continue
      </SubmitButton>
    </form>
  );
}
