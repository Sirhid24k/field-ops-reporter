"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { describeAuthError } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { fieldErrorsFrom, text } from "@/lib/forms";
import { completeJoin, getInviteByCode, PENDING_INVITE_COOKIE, PENDING_NAME_COOKIE } from "@/lib/invites";
import { homeFor } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type JoinState =
  | {
      sent?: string;
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: { fullName: string; email: string };
    }
  | undefined;

const schema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, "This invite link isn't valid."),
  fullName: z.string().trim().min(2, "Enter your name.").max(80, "Keep your name under 80 characters."),
  email: z.email("Enter a valid email address."),
});

const INVALID = "This invite link isn't valid anymore. Ask your supervisor for a new one.";

const pendingCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};

/** F1: sends the magic link; the name travels as user metadata and in a cookie. */
export async function sendJoinLink(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const values = { fullName: text(formData, "fullName"), email: text(formData, "email").toLowerCase() };
  const parsed = schema.safeParse({ code: text(formData, "code"), ...values });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };

  const invite = await getInviteByCode(parsed.data.code);
  if (!invite || invite.status !== "valid") return { error: INVALID, values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(`/join/${invite.code}/complete`)}`,
      data: { full_name: parsed.data.fullName },
    },
  });
  if (error) return { error: describeAuthError(error.code), values };

  const cookieStore = await cookies();
  cookieStore.set(PENDING_INVITE_COOKIE, invite.code, pendingCookie);
  cookieStore.set(PENDING_NAME_COOKIE, parsed.data.fullName, pendingCookie);

  return { sent: parsed.data.email };
}

/** For someone already signed in (no profile yet) who opens the invite: one tap to join. */
export async function joinNow(formData: FormData): Promise<void> {
  const code = text(formData, "code");
  const { user } = await getSession();
  if (!user) redirect(`/join/${code}`);

  const cookieStore = await cookies();
  const result = await completeJoin(user, code, cookieStore.get(PENDING_NAME_COOKIE)?.value ?? null);
  cookieStore.delete(PENDING_INVITE_COOKIE);
  cookieStore.delete(PENDING_NAME_COOKIE);

  if (!result.ok) redirect(`/join/${code}?error=${result.reason}`);
  redirect(homeFor(result.role));
}
