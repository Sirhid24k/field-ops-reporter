import type { Metadata } from "next";
import { cookies } from "next/headers";
import { OTP_LENGTH, PENDING_EMAIL_COOKIE } from "@/lib/auth-otp";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<{ next?: string; step?: string; reason?: string; error?: string }>;

/**
 * Email code sign-in. A failed email link (/auth/callback) sends people here with
 * `step=code&reason=link`; when the pending-email cookie is present they land on the code
 * step with the address prefilled, otherwise on the email step with a notice.
 */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, step, reason, error } = await searchParams;
  const pendingEmail = (await cookies()).get(PENDING_EMAIL_COOKIE)?.value ?? null;

  const fromLink = reason === "link" || error === "link";
  const startOnCode = step === "code" && pendingEmail !== null;
  const notice = fromLink
    ? startOnCode
      ? `That sign-in link didn't work here. Enter the ${OTP_LENGTH}-digit code from the same email instead.`
      : "That sign-in link didn't work here. Enter your email and we'll send you a code."
    : undefined;

  return (
    <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col px-6 py-12">
      <p className="font-display text-heading font-bold">Field Ops Reporter</p>
      <h1 className="mt-10 font-display text-title font-bold">Sign in</h1>
      <SignInForm
        next={next}
        initialEmail={pendingEmail ?? undefined}
        initialStep={startOnCode ? "code" : "email"}
        notice={notice}
      />
    </main>
  );
}
