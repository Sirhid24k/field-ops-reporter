import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/types";
import { isStaff } from "@/lib/roles";

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
