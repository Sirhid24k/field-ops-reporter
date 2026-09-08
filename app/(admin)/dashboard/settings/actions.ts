"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fieldErrorsFrom, text, type FormState } from "@/lib/forms";
import { TIMEZONES } from "@/lib/options";

const schema = z.object({
  orgName: z.string().trim().min(2, "Enter your business name.").max(120, "Keep the name under 120 characters."),
  timezone: z.string().refine((zone) => TIMEZONES.includes(zone), "Pick a timezone from the list."),
  cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a cutoff time."),
});

/** Updates the caller's organisation as the user (RLS: staff may update their own org row). */
export async function saveOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    orgName: text(formData, "orgName"),
    timezone: text(formData, "timezone"),
    cutoff: text(formData, "cutoff"),
  };
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const { supabase, organization } = await requireStaff();
  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.orgName, timezone: parsed.data.timezone, report_cutoff_time: parsed.data.cutoff })
    .eq("id", organization.id);
  if (error) return { error: "Couldn't save the settings. Try again.", values };

  revalidatePath("/dashboard", "layout");
  return { done: true, values };
}
