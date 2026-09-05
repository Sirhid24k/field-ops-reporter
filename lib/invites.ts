import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { roleLabel, type UserRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const INVITE_TTL_DAYS = 7;

/** Cookies that carry an in-progress invite across the magic-link round trip. */
export { PENDING_INVITE_COOKIE, PENDING_NAME_COOKIE } from "@/lib/invites-shared";

const CODE_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** 12 URL-safe characters, 72 bits of entropy. */
export function generateInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

export function inviteUrl(code: string): string {
  return `${publicEnv.appUrl}/join/${code}`;
}

export function inviteMessage(orgName: string, role: UserRole, code: string): string {
  return `${orgName} added you as a ${roleLabel(role)} on Field Ops Reporter. Open this link on your phone to sign in: ${inviteUrl(code)}`;
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export type InviteLookup = {
  id: string;
  code: string;
  role: UserRole;
  orgId: string;
  orgName: string;
  expiresAt: string;
  status: "valid" | "used" | "expired";
};

/**
 * Reads an invite for the public /join page. Runs with the service role because
 * the visitor has no session yet; only the org name and role are returned.
 */
export async function getInviteByCode(code: string): Promise<InviteLookup | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const admin = createAdminClient();

  const { data: invite } = await admin
    .from("invites")
    .select("id, code, role, org_id, expires_at, used_by")
    .eq("code", code)
    .maybeSingle();
  if (!invite) return null;

  const { data: organization } = await admin.from("organizations").select("name").eq("id", invite.org_id).maybeSingle();
  if (!organization) return null;

  const status = invite.used_by ? "used" : new Date(invite.expires_at) <= new Date() ? "expired" : "valid";

  return {
    id: invite.id,
    code: invite.code,
    role: invite.role,
    orgId: invite.org_id,
    orgName: organization.name,
    expiresAt: invite.expires_at,
    status,
  };
}

/**
 * Finds an unused, unexpired field invite for the org or creates one.
 * Runs as the admin (staff policy on `invites`).
 */
export async function ensureFieldInvite(supabase: SupabaseClient<Database>, orgId: string) {
  const { data: existing } = await supabase
    .from("invites")
    .select("id, code, role, expires_at")
    .eq("org_id", orgId)
    .eq("role", "field")
    .is("used_by", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: created, error } = await supabase
    .from("invites")
    .insert({ org_id: orgId, role: "field", code: generateInviteCode(), expires_at: expiresAt })
    .select("id, code, role, expires_at")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the invite.");
  return created;
}

export type CompleteJoinResult =
  | { ok: true; role: UserRole; alreadyMember: boolean }
  | { ok: false; reason: "invalid" | "used" | "expired" | "failed" };

/**
 * Creates the profile for a signed-in user from an invite and marks the invite used.
 * Idempotent: a user who already has a profile is simply routed by their role.
 */
export async function completeJoin(user: User, code: string, fallbackName?: string | null): Promise<CompleteJoinResult> {
  const admin = createAdminClient();

  const { data: existing } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (existing) return { ok: true, role: existing.role, alreadyMember: true };

  const invite = await getInviteByCode(code);
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.status !== "valid") return { ok: false, reason: invite.status };

  const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const fullName = (metadataName || fallbackName || user.email?.split("@")[0] || "New member").trim().slice(0, 80);

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: user.id, org_id: invite.orgId, full_name: fullName, role: invite.role });
  if (profileError) return { ok: false, reason: "failed" };

  // best effort: a second concurrent completion would already have used the invite
  await admin.from("invites").update({ used_by: user.id }).eq("id", invite.id).is("used_by", null);

  return { ok: true, role: invite.role, alreadyMember: false };
}
