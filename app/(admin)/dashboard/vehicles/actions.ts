"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { fieldErrorsFrom, text, type FormState } from "@/lib/forms";

/** Vehicles (M17), all as the signed-in supervisor: RLS gives staff full access to their org's vehicles. */

const vehicleSchema = z.object({
  vehicleId: z.union([z.literal(""), z.uuid()]),
  plate: z
    .string()
    .trim()
    .min(2, "Enter the plate number.")
    .max(20, "That plate number is too long.")
    .transform((value) => value.toUpperCase().replace(/\s+/g, " ")),
  label: z.string().trim().max(80, "Keep the label under 80 characters."),
  vehicleType: z.string().trim().max(40, "Keep the type under 40 characters."),
  driverId: z.union([z.literal(""), z.uuid()]),
  odometer: z
    .string()
    .trim()
    .transform((raw, ctx) => {
      if (!raw) return null;
      const value = Number(raw.replace(/[\s,  ]/g, ""));
      if (!Number.isFinite(value) || value < 0 || value > 9_999_999) {
        ctx.addIssue({ code: "custom", message: "Enter the odometer as a number, like 184220." });
        return z.NEVER;
      }
      return Math.round(value);
    }),
});

/** Add (empty vehicleId) or edit a vehicle from the drawer form. */
export async function saveVehicle(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = {
    vehicleId: text(formData, "vehicleId"),
    plate: text(formData, "plate"),
    label: text(formData, "label"),
    vehicleType: text(formData, "vehicleType"),
    driverId: text(formData, "driverId"),
    odometer: text(formData, "odometer"),
  };
  const parsed = vehicleSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const { supabase, organization } = await requireStaff();
  const { vehicleId, plate, label, vehicleType, driverId, odometer } = parsed.data;

  if (driverId) {
    const { data: driver } = await supabase.from("profiles").select("id").eq("id", driverId).eq("org_id", organization.id).maybeSingle();
    if (!driver) return { fieldErrors: { driverId: "Pick a driver from the list." }, values };
  }

  const row = {
    plate_number: plate,
    label: label || null,
    vehicle_type: vehicleType || null,
    default_driver_id: driverId || null,
    current_odometer: odometer,
  };
  const { error } = vehicleId
    ? await supabase.from("vehicles").update(row).eq("id", vehicleId).eq("org_id", organization.id)
    : await supabase.from("vehicles").insert({ org_id: organization.id, ...row });
  if (error) {
    if (error.code === "23505") return { fieldErrors: { plate: "That plate is already added. Enter a different one." }, values };
    return { error: "Couldn't save the vehicle. Try again.", values };
  }

  revalidatePath("/dashboard", "layout");
  return { done: true };
}

const activeSchema = z.object({ vehicleId: z.uuid(), active: z.boolean() });

/** Deactivate / reactivate. Deactivated vehicles leave the board and the driver's vehicle list; nothing is deleted. */
export async function setVehicleActive(rawInput: unknown): Promise<{ ok: boolean; message?: string }> {
  const parsed = activeSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, message: "This vehicle couldn't be found." };
  const { supabase, organization } = await requireStaff();

  const { data, error } = await supabase
    .from("vehicles")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.vehicleId)
    .eq("org_id", organization.id)
    .select("id");
  if (error) return { ok: false, message: `Couldn't save the change: ${error.message}` };
  if (!data || data.length === 0) return { ok: false, message: "This vehicle couldn't be found." };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
