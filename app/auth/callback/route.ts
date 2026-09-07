import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { landingFor } from "@/lib/auth";
import { PENDING_EMAIL_COOKIE, safeNext } from "@/lib/auth-otp";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
const JOIN_NEXT = /^\/join\/([A-Za-z0-9_-]{6,64})(?:\/complete)?\/?$/;

function log(event: Record<string, unknown>): void {
  console.warn(JSON.stringify({ at: new Date().toISOString(), src: "auth.callback", ...event }));
}

/**
 * The link in the sign-in email; the code is the primary path, this is the fallback.
 * Handles both link styles:
 *   ?token_hash=…&type=magiclink  token-hash template ({{ .TokenHash }}); works in any browser
 *   ?code=…                       PKCE (the default {{ .ConfirmationURL }} template); only works in
 *                                 the browser that asked for the code, because the verifier is a cookie
 * Success: session cookies are set through the SSR client and the person is routed by role.
 * Failure: they land on the code step of the flow they came from, with their email prefilled
 * from the pending cookie when it exists, and the reason is logged.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  // Supabase's own verify step reports an expired or already-used link with these instead of a code
  const upstreamError = searchParams.get("error_code") ?? searchParams.get("error");
  const upstreamDescription = searchParams.get("error_description");

  const supabase = await createClient();
  let userId: string | null = null;
  let failure: { code?: string; message: string } | null = null;
  const via = code ? "code" : tokenHash ? "token_hash" : "none";

  if (upstreamError) {
    failure = { code: upstreamError, message: upstreamDescription ?? "reported by Supabase" };
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) failure = { code: error.code, message: error.message };
    else userId = data.user?.id ?? null;
  } else if (tokenHash && type && EMAIL_OTP_TYPES.includes(type as EmailOtpType)) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (error) failure = { code: error.code, message: error.message };
    else userId = data.user?.id ?? null;
  } else {
    failure = { code: "missing_params", message: "the link had neither code nor token_hash" };
  }

  if (failure || !userId) {
    log({ outcome: "failed", via, next, ...(failure ?? { message: "no user in the session" }) });
    const joinCode = JOIN_NEXT.exec(next)?.[1];
    const target = joinCode
      ? `/join/${joinCode}?step=code&reason=link`
      : `/signin?step=code&reason=link${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`;
    return NextResponse.redirect(new URL(target, origin));
  }

  const destination = await landingFor(supabase, userId, next);
  log({ outcome: "ok", via, next, destination });
  const response = NextResponse.redirect(new URL(destination, origin));
  response.cookies.delete(PENDING_EMAIL_COOKIE);
  return response;
}
