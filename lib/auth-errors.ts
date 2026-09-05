/** Plain-language auth errors: what happened and what to do next (design-brief §7). */
export function describeAuthError(code: string | undefined): string {
  switch (code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many sign-in links were sent. Wait a few minutes, then try again.";
    case "email_address_invalid":
      return "That email address doesn't look right. Check it and try again.";
    case "signup_disabled":
      return "Sign-ups are closed. Ask your supervisor for an invite link.";
    default:
      return "Couldn't send the link. Check the email address and try again.";
  }
}
