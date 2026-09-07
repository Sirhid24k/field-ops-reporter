/**
 * Email one-time-code sign-in: the pieces shared by /signin, /join/[code] and the
 * link-fallback callback. Pure and server/client safe (no Node or Next imports), so the
 * client forms and the unit tests can use them too.
 */

/**
 * Length of the code Supabase emails. The project setting (Authentication → Email → "Email
 * OTP length") decides; NEXT_PUBLIC_OTP_LENGTH must match it (default 6). Inlined into the
 * client bundle, so the input, the auto-submit and the copy all agree with the server.
 */
export const OTP_LENGTH = (() => {
  const configured = Number(process.env.NEXT_PUBLIC_OTP_LENGTH);
  return Number.isInteger(configured) && configured >= 6 && configured <= 10 ? configured : 6;
})();

/** "Send a new code" stays disabled this long after a send. */
export const RESEND_SECONDS = 60;

/**
 * The address a code was last sent to, so the link fallback can land on the code step
 * with the email prefilled. httpOnly, one hour, same site.
 */
export const PENDING_EMAIL_COOKIE = "fo_pending_email";
export const PENDING_EMAIL_MAX_AGE = 60 * 60;

/** Digits only, at most six: pasted codes arrive as "123 456", "123-456" or "Your code is 123456". */
export function normalizeOtpCode(raw: string): string {
  return raw.replace(/\D+/g, "").slice(0, OTP_LENGTH);
}

export function isCompleteOtpCode(code: string): boolean {
  return code.length === OTP_LENGTH && /^\d+$/.test(code);
}

/** Only same-origin paths may be used as a post-sign-in destination; anything else goes to the root router. */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/** Design-brief §7: what happened and what to do. Wrong and expired codes read the same to the person. */
export const OTP_MISMATCH = "That code didn't match. Check the newest email or send a new code.";

export function describeOtpError(code: string | undefined): string {
  switch (code) {
    case "otp_expired":
    case "otp_disabled":
    case "invalid_credentials":
    case "validation_failed":
    case "bad_code_verifier":
      return OTP_MISMATCH;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many tries. Wait a minute, then send a new code.";
    default:
      return "Couldn't check that code. Send a new code and try again.";
  }
}

/** Plain-language errors for the send step. */
export function describeSendError(code: string | undefined): string {
  switch (code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many codes were sent. Wait a few minutes, then try again.";
    case "email_address_invalid":
      return "That email address doesn't look right. Check it and try again.";
    case "signup_disabled":
      return "Sign-ups are closed. Ask your supervisor for an invite link.";
    default:
      return "Couldn't send the code. Check the email address and try again.";
  }
}
