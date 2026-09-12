import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { roleLabel, type UserRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export const INVITE_TTL_DAYS = 7;

/** Cookies that carry an in-progress invite across the sign-in round trip. */
export { PENDING_INVITE_COOKIE, PENDING_NAME_COOKIE } from "@/lib/invites-shared";

const CODE_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** 12 URL-safe characters, 72 bits of entropy. */
export function generateInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

/** `origin` is the request's (lib/request-origin.ts), so the link comes back to the deployment that made it. */
export function inviteUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/join/${code}`;
}

export function inviteMessage(origin: string, orgName: string, role: UserRole, code: string): string {
  return `${orgName} added you as a ${roleLabel(role)} on Field Ops Reporter. Open this link on your phone to sign in: ${inviteUrl(origin, code)}`;
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
 * Finds an unused, unexpired invite for the org and role or creates one, so the same link
 * stays valid until someone uses it. Runs as the admin (staff policy on `invites`).
 */
export async function ensureInvite(supabase: SupabaseClient<Database>, orgId: string, role: UserRole) {
  const { data: existing } = await supabase
    .from("invites")
    .select("id, code, role, expires_at")
    .eq("org_id", orgId)
    .eq("role", role)
    .is("used_by", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: created, error } = await supabase
    .from("invites")
    .insert({ org_id: orgId, role, code: generateInviteCode(), expires_at: expiresAt })
    .select("id, code, role, expires_at")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the invite.");
  return created;
}

/** The onboarding step 3 invite: role fixed to driver. */
export function ensureFieldInvite(supabase: SupabaseClient<Database>, orgId: string) {
  return ensureInvite(supabase, orgId, "field");
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
  if (invite.status === "expired") return { ok: false, reason: "expired" };
  // status is "valid" or "used"; the atomic claim below is the real single-use gate, so a
  // retry by the same user whose earlier attempt already claimed the invite still completes.

  const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  const fullName = (metadataName || fallbackName || user.email?.split("@")[0] || "New member").trim().slice(0, 80);

  // Claim the invite atomically before creating the profile. `update … where used_by is null`
  // row-locks, so of two concurrent completions exactly one matches a row and wins; the loser
  // matches nothing and, unless it was this same user on an earlier attempt, is told it is used.
  // (Previously each racer inserted its own profile and only then marked the invite used, so a
  // single-use invite could seed two members — FOR-01.)
  const { data: claimed, error: claimError } = await admin
    .from("invites")
    .update({ used_by: user.id })
    .eq("id", invite.id)
    .is("used_by", null)
    .select("id");
  if (claimError) return { ok: false, reason: "failed" };
  if (!claimed || claimed.length === 0) {
    const { data: current } = await admin.from("invites").select("used_by").eq("id", invite.id).maybeSingle();
    if (current?.used_by !== user.id) return { ok: false, reason: "used" };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .insert({ id: user.id, org_id: invite.orgId, full_name: fullName, role: invite.role });
  // 23505 = the profile already exists (a concurrent same-user completion won); treat as done.
  if (profileError && profileError.code !== "23505") return { ok: false, reason: "failed" };

  return { ok: true, role: invite.role, alreadyMember: false };
}
