import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/** Only same-origin paths; anything else falls back to the root router. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/**
 * Magic-link landing. Handles both link styles:
 *   ?code=…                       PKCE flow from the default Supabase email template
 *   ?token_hash=…&type=magiclink  token-hash flow (custom email template or scripts/dev-magic-link.mts),
 *                                 which also works when the link is opened in a different browser
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createClient();
  let signedIn = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    signedIn = !error;
  } else if (tokenHash && type && EMAIL_OTP_TYPES.includes(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    signedIn = !error;
  }

  if (!signedIn) {
    const back = next.startsWith("/join/") ? next.replace(/\/complete$/, "") : "/signin";
    return NextResponse.redirect(new URL(`${back}?error=link`, origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
