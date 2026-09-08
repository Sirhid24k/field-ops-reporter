"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { dateInZone, formatDateTime } from "@/lib/dates";

export type AcknowledgeResult = { ok: true; label: string } | { ok: false; message: string };

const schema = z.object({ alertId: z.uuid() });

/**
 * One-click acknowledge (M16), as the user: RLS lets staff update alerts in their org.
 * Returns the line the row shows in place of the button, already in the org's timezone.
 */
export async function acknowledgeAlert(rawInput: unknown): Promise<AcknowledgeResult> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, message: "This alert couldn't be found." };
  const { supabase, profile, organization } = await requireStaff();

  const at = new Date().toISOString();
  const { data, error } = await supabase
    .from("alerts")
    .update({ status: "acknowledged", acknowledged_by: profile.id, acknowledged_at: at })
    .eq("id", parsed.data.alertId)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, message: `Couldn't acknowledge the alert: ${error.message}` };
  if (!data || data.length === 0) return { ok: false, message: "This alert was already acknowledged. Reload the page to see by whom." };

  revalidatePath("/dashboard", "layout");
  return { ok: true, label: `Acknowledged by you, ${formatDateTime(at, organization.timezone, dateInZone(new Date(), organization.timezone))}` };
}
