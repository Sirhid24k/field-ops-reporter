"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { describeAuthError } from "@/lib/auth-errors";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { sent?: string; error?: string; values?: { email: string } } | undefined;

const schema = z.object({
  email: z.email("Enter a valid email address."),
  next: z.string().optional(),
});

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/** Sends a magic link for /signin. New emails create an account. */
export async function sendSignInLink(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const parsed = schema.safeParse({ email, next: formData.get("next") ?? undefined });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email address.", values: { email } };
  }

  const next = safeNext(parsed.data.next);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: describeAuthError(error.code), values: { email } };

  return { sent: parsed.data.email };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/signin");
}
