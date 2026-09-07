"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { landingFor } from "@/lib/auth";
import {
  describeOtpError,
  describeSendError,
  isCompleteOtpCode,
  normalizeOtpCode,
  PENDING_EMAIL_COOKIE,
  PENDING_EMAIL_MAX_AGE,
  safeNext,
} from "@/lib/auth-otp";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign-in is an email one-time code: `signInWithOtp` sends it (the email also carries a
 * link, see /auth/callback), `verifyOtp` checks it through the SSR client so the session
 * cookies are set on this response, then the person is routed by role.
 */

export type SendCodeState =
  | { step: "email"; error?: string; values?: { email: string } }
  | { step: "code"; email: string; sentAt: number }
  | undefined;

export type VerifyCodeState = { error?: string; attempt: number } | undefined;

const emailSchema = z.email("Enter a valid email address.");

const pendingEmailCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: PENDING_EMAIL_MAX_AGE,
};

/** Step 1 of /signin: sends the code. New emails create an account. */
export async function sendSignInCode(_prev: SendCodeState, formData: FormData): Promise<SendCodeState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return { step: "email", error: parsed.error.issues[0]?.message ?? "Enter a valid email address.", values: { email } };
  }
  const next = safeNext(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const origin = await getRequestOrigin(); // this deployment's host, so the link comes back here (previews too)
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      // the link in the same email: any browser with the token-hash template, same browser only with PKCE
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { step: "email", error: describeSendError(error.code), values: { email } };

  (await cookies()).set(PENDING_EMAIL_COOKIE, parsed.data, pendingEmailCookie);
  return { step: "code", email: parsed.data, sentAt: Date.now() };
}

/** Step 2 of /signin: checks the code, sets the session cookies, routes by role. */
export async function verifySignInCode(prev: VerifyCodeState, formData: FormData): Promise<VerifyCodeState> {
  const attempt = (prev?.attempt ?? 0) + 1;
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = normalizeOtpCode(String(formData.get("token") ?? ""));
  if (!emailSchema.safeParse(email).success) return { error: "Enter your email again, then the code.", attempt };
  if (!isCompleteOtpCode(token)) return { error: "Enter the 6-digit code from the email.", attempt };
  const next = safeNext(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) return { error: describeOtpError(error?.code), attempt };

  (await cookies()).delete(PENDING_EMAIL_COOKIE);
  redirect(await landingFor(supabase, data.user.id, next));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/signin");
}
