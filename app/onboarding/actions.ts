"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { fieldErrorsFrom, text, type FormState } from "@/lib/forms";
import { ensureFieldInvite } from "@/lib/invites";
import { TIMEZONES } from "@/lib/options";
import { isStaff } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

const orgSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your name.").max(80, "Keep your name under 80 characters."),
  orgName: z.string().trim().min(2, "Enter your business name.").max(120, "Keep the name under 120 characters."),
  timezone: z.string().refine((zone) => TIMEZONES.includes(zone), "Pick a timezone from the list."),
  cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a cutoff time."),
});

const vehicleSchema = z.object({
  plate: z
    .string()
    .trim()
    .min(2, "Enter the plate number.")
    .max(20, "That plate number is too long.")
    .transform((value) => value.toUpperCase().replace(/\s+/g, " ")),
  label: z.string().trim().max(80, "Keep the label under 80 characters."),
  odometer: z
    .string()
    .trim()
    .transform((raw, ctx) => {
      if (!raw) return null;
      const value = Number(raw.replace(/[\s,]/g, ""));
      if (!Number.isFinite(value) || value < 0 || value > 9_999_999) {
        ctx.addIssue({ code: "custom", message: "Enter the odometer as a number, like 184220." });
        return z.NEVER;
      }
      return Math.round(value);
    }),
});

/** Step 1: the signed-in user has no profile yet, so both rows are created with the service role. */
export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    fullName: text(formData, "fullName"),
    orgName: text(formData, "orgName"),
    timezone: text(formData, "timezone"),
    cutoff: text(formData, "cutoff"),
  };
  const parsed = orgSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const { user, profile } = await getSession();
  if (!user) redirect("/signin?next=/onboarding");
  if (profile) redirect("/onboarding?step=2");

  const admin = createAdminClient();
  const { data: organization, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: parsed.data.orgName,
      timezone: parsed.data.timezone,
      report_cutoff_time: parsed.data.cutoff,
    })
    .select("id")
    .single();
  if (orgError || !organization) return { error: "Couldn't save your business. Try again.", values };

  const { error: profileError } = await admin.from("profiles").insert({
    id: user.id,
    org_id: organization.id,
    full_name: parsed.data.fullName,
    role: "admin",
  });
  if (profileError) {
    await admin.from("organizations").delete().eq("id", organization.id);
    return { error: "Couldn't set up your account. Try again.", values };
  }

  redirect("/onboarding?step=2");
}

async function requireAdmin() {
  const session = await getSession();
  if (!session.user) redirect("/signin?next=/onboarding");
  if (!session.profile) redirect("/onboarding");
  if (!isStaff(session.profile.role)) redirect("/app");
  return { supabase: session.supabase, profile: session.profile };
}

/** Step 2: runs as the admin; RLS lets staff insert vehicles in their org. */
export async function addVehicle(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    plate: text(formData, "plate"),
    label: text(formData, "label"),
    odometer: text(formData, "odometer"),
  };
  const parsed = vehicleSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const { supabase, profile } = await requireAdmin();
  const { error } = await supabase.from("vehicles").insert({
    org_id: profile.org_id,
    plate_number: parsed.data.plate,
    label: parsed.data.label || null,
    current_odometer: parsed.data.odometer,
  });
  if (error) {
    if (error.code === "23505") {
      return { fieldErrors: { plate: "That plate is already added. Enter a different one." }, values };
    }
    return { error: "Couldn't save the vehicle. Try again.", values };
  }

  await ensureFieldInvite(supabase, profile.org_id);
  redirect("/onboarding?step=3");
}

/** Step 2, "Skip for now": still prepares the invite for step 3. */
export async function skipVehicle(): Promise<void> {
  const { supabase, profile } = await requireAdmin();
  await ensureFieldInvite(supabase, profile.org_id);
  redirect("/onboarding?step=3");
}

/** Step 3 fallback when no unused invite exists (e.g. the page was opened directly). */
export async function generateInvite(): Promise<void> {
  const { supabase, profile } = await requireAdmin();
  await ensureFieldInvite(supabase, profile.org_id);
  redirect("/onboarding?step=3");
}
