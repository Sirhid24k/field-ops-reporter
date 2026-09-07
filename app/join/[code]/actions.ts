"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  describeOtpError,
  describeSendError,
  isCompleteOtpCode,
  normalizeOtpCode,
  PENDING_EMAIL_COOKIE,
  PENDING_EMAIL_MAX_AGE,
} from "@/lib/auth-otp";
import { publicEnv } from "@/lib/env";
import { fieldErrorsFrom, text } from "@/lib/forms";
import { completeJoin, getInviteByCode, PENDING_INVITE_COOKIE, PENDING_NAME_COOKIE } from "@/lib/invites";
import { homeFor } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type JoinSendState =
  | {
      step: "form";
      error?: string;
      fieldErrors?: Record<string, string>;
      values?: { fullName: string; email: string };
    }
  | { step: "code"; email: string; fullName: string; sentAt: number }
  | undefined;

export type JoinVerifyState = { error?: string; attempt: number } | undefined;

const codeSchema = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, "This invite link isn't valid.");
const schema = z.object({
  code: codeSchema,
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

/** F1 step 1: sends the code; the name travels as user metadata and in a cookie. */
export async function sendJoinCode(_prev: JoinSendState, formData: FormData): Promise<JoinSendState> {
  const values = { fullName: text(formData, "fullName"), email: text(formData, "email").toLowerCase() };
  const parsed = schema.safeParse({ code: text(formData, "code"), ...values });
  if (!parsed.success) return { step: "form", fieldErrors: fieldErrorsFrom(parsed.error), values };

  const invite = await getInviteByCode(parsed.data.code);
  if (!invite || invite.status !== "valid") return { step: "form", error: INVALID, values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      // the link in the same email: the fallback path, which completes the join in /join/[code]/complete
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(`/join/${invite.code}/complete`)}`,
      data: { full_name: parsed.data.fullName },
    },
  });
  if (error) return { step: "form", error: describeSendError(error.code), values };

  const cookieStore = await cookies();
  cookieStore.set(PENDING_INVITE_COOKIE, invite.code, pendingCookie);
  cookieStore.set(PENDING_NAME_COOKIE, parsed.data.fullName, pendingCookie);
  cookieStore.set(PENDING_EMAIL_COOKIE, parsed.data.email, { ...pendingCookie, maxAge: PENDING_EMAIL_MAX_AGE });

  return { step: "code", email: parsed.data.email, fullName: parsed.data.fullName, sentAt: Date.now() };
}

/**
 * F1 step 2: checks the code, then the existing completion runs unchanged (`completeJoin`
 * creates the profile with the invite's org and role and marks the invite used) and the
 * person is routed by role.
 */
export async function verifyJoinCode(prev: JoinVerifyState, formData: FormData): Promise<JoinVerifyState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const code = text(formData, "code");
  const email = text(formData, "email").toLowerCase();
  const token = normalizeOtpCode(text(formData, "token"));
  if (!codeSchema.safeParse(code).success) return { error: INVALID, attempt };
  if (!z.email().safeParse(email).success) return { error: "Enter your email again, then the code.", attempt };
  if (!isCompleteOtpCode(token)) return { error: "Enter the 6-digit code from the email.", attempt };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) return { error: describeOtpError(error?.code), attempt };

  const cookieStore = await cookies();
  const fallbackName = text(formData, "fullName") || cookieStore.get(PENDING_NAME_COOKIE)?.value || null;
  const result = await completeJoin(data.user, code, fallbackName);
  cookieStore.delete(PENDING_INVITE_COOKIE);
  cookieStore.delete(PENDING_NAME_COOKIE);
  cookieStore.delete(PENDING_EMAIL_COOKIE);

  if (!result.ok) redirect(`/join/${code}?error=${result.reason}`);
  redirect(homeFor(result.role));
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
  cookieStore.delete(PENDING_EMAIL_COOKIE);

  if (!result.ok) redirect(`/join/${code}?error=${result.reason}`);
  redirect(homeFor(result.role));
}
