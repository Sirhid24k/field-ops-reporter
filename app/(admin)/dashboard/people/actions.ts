"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { ensureInvite, inviteMessage, inviteUrl, whatsappShareUrl } from "@/lib/invites";
import { getRequestOrigin } from "@/lib/request-origin";

/** People (M17): invite links and the active switch, all as the signed-in supervisor under RLS. */

export type InviteLinkResult = { ok: true; url: string; whatsappUrl: string } | { ok: false; message: string };

const inviteSchema = z.object({ role: z.enum(["field", "supervisor"]) });

/**
 * A link for the chosen role: an unused, unexpired invite is reused, otherwise one is
 * created. The link points at the host this dashboard was opened on.
 */
export async function createInviteLink(rawInput: unknown): Promise<InviteLinkResult> {
  const parsed = inviteSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, message: "Pick a role first." };
  const { supabase, organization } = await requireStaff();

  try {
    const invite = await ensureInvite(supabase, organization.id, parsed.data.role);
    const origin = await getRequestOrigin();
    return {
      ok: true,
      url: inviteUrl(origin, invite.code),
      whatsappUrl: whatsappShareUrl(inviteMessage(origin, organization.name, parsed.data.role, invite.code)),
    };
  } catch {
    return { ok: false, message: "Couldn't create the link. Try again." };
  }
}

const activeSchema = z.object({ profileId: z.uuid(), active: z.boolean() });

/**
 * Deactivate / reactivate a person. A deactivated profile loses all access at once
 * (current_org_id() returns null for it); their reports stay. You cannot deactivate yourself.
 */
export async function setPersonActive(rawInput: unknown): Promise<{ ok: boolean; message?: string }> {
  const parsed = activeSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, message: "This person couldn't be found." };
  const { supabase, organization, profile } = await requireStaff();
  if (parsed.data.profileId === profile.id) return { ok: false, message: "You can't deactivate yourself. Ask another admin." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.profileId)
    .eq("org_id", organization.id)
    .select("id");
  if (error) return { ok: false, message: `Couldn't save the change: ${error.message}` };
  if (!data || data.length === 0) return { ok: false, message: "This person couldn't be found." };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
