import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { PENDING_INVITE_COOKIE } from "@/lib/invites-shared";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";
import { homeFor, isStaff } from "@/lib/roles";

export type Profile = Tables<"profiles">;
export type Organization = Tables<"organizations">;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type Session = {
  supabase: SupabaseServerClient;
  user: User | null;
  profile: Profile | null;
  organization: Organization | null;
};

export type MemberSession = Session & {
  user: User;
  profile: Profile;
  organization: Organization;
};

/** The signed-in user plus their profile and organization, all as the user sees them under RLS. */
export async function getSession(): Promise<Session> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null, organization: null };

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) return { supabase, user, profile: null, organization: null };

  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.org_id)
    .maybeSingle();

  return { supabase, user, profile, organization: organization ?? null };
}

export async function requireUser(next?: string): Promise<Session & { user: User }> {
  const session = await getSession();
  if (!session.user) redirect(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  return { ...session, user: session.user };
}

/** A signed-in user with a profile; otherwise they are sent to onboarding. */
export async function requireMember(): Promise<MemberSession> {
  const session = await requireUser();
  if (!session.profile || !session.organization) redirect("/onboarding");
  return { ...session, profile: session.profile, organization: session.organization };
}

export async function requireStaff(): Promise<MemberSession> {
  const session = await requireMember();
  if (!isStaff(session.profile.role)) redirect("/app");
  return session;
}

const INVITE_CODE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Where someone goes right after signing in (code or link): a safe `next` path when one was
 * asked for, otherwise the same routing proxy.ts applies to "/": home by role for members,
 * the pending invite's completion for someone mid-join, onboarding for everyone else.
 * `next` must already have been through `safeNext`.
 */
export async function landingFor(supabase: SupabaseServerClient, userId: string, next: string | null | undefined): Promise<string> {
  if (next && next !== "/") return next;

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profile) return homeFor(profile.role);

  const pendingInvite = (await cookies()).get(PENDING_INVITE_COOKIE)?.value;
  if (pendingInvite && INVITE_CODE.test(pendingInvite)) return `/join/${pendingInvite}/complete`;
  return "/onboarding";
}
