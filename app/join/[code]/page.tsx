import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { Button, SubmitButton } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { getInviteByCode } from "@/lib/invites";
import { homeFor, roleLabel } from "@/lib/roles";
import { joinNow } from "./actions";
import { JoinForm } from "./JoinForm";

export const metadata: Metadata = { title: "Join" };

type Params = Promise<{ code: string }>;
type SearchParams = Promise<{ error?: string }>;

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pt-8 pb-8">
      <p className="text-caption text-steel">Field Ops Reporter</p>
      {children}
    </main>
  );
}

function Heading({ orgName, role }: { orgName: string; role: string }) {
  return (
    <>
      <h1 className="mt-10 font-display text-title font-semibold text-steel">
        <strong className="font-bold text-ink">{orgName}</strong> added you as a{" "}
        <strong className="font-bold text-ink">{role}</strong>
      </h1>
      <p className="mt-2 text-body-lg text-steel">Sign in to send your daily report.</p>
    </>
  );
}

const ERRORS: Record<string, string> = {
  link: "That sign-in link didn't work. It may have expired. Send a new one.",
  used: "This invite link has already been used. Ask your supervisor for a new one.",
  expired: "This invite link has expired. Ask your supervisor for a new one.",
  invalid: "This invite link isn't valid anymore. Ask your supervisor for a new one.",
  failed: "Couldn't finish signing you up. Open the link again to retry.",
};

/** F1 — sign in from invite. Handles every state of the invite and of the visitor. */
export default async function JoinPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { code } = await params;
  const { error } = await searchParams;

  const [invite, { user, profile }] = await Promise.all([getInviteByCode(code), getSession()]);

  // someone who already belongs to this org (e.g. re-opening the link they joined with) just goes home
  if (user && profile && (!invite || profile.org_id === invite.orgId)) redirect(homeFor(profile.role));

  if (!invite || invite.status !== "valid") {
    const reason = invite?.status ?? "invalid";
    return (
      <Shell>
        <h1 className="mt-10 font-display text-title font-bold">This link doesn&rsquo;t work</h1>
        <p className="mt-3 text-body-lg">{ERRORS[reason]}</p>
        <div className="flex-1" />
        {user ? (
          <form action={signOut}>
            <Button type="submit" variant="text">
              Sign out
            </Button>
          </form>
        ) : null}
      </Shell>
    );
  }

  const role = roleLabel(invite.role);

  if (user && profile) {
    return (
      <Shell>
        <Heading orgName={invite.orgName} role={role} />
        <p className="mt-8 text-body-lg">
          You&rsquo;re already signed in as {profile.full_name}. Sign out first, then open this link again to join{" "}
          {invite.orgName}.
        </p>
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="secondary" size="field" block>
            Sign out
          </Button>
        </form>
      </Shell>
    );
  }

  if (user) {
    return (
      <Shell>
        <Heading orgName={invite.orgName} role={role} />
        <p className="mt-8 text-body-lg">You&rsquo;re signed in as {user.email}.</p>
        {error && ERRORS[error] ? (
          <p role="alert" className="mt-4 border-l-4 border-flag pl-3 text-body text-flag">
            {ERRORS[error]}
          </p>
        ) : null}
        <form action={joinNow} className="mt-6">
          <input type="hidden" name="code" value={invite.code} />
          <SubmitButton size="field" loadingLabel="Joining…" block>
            Join {invite.orgName}
          </SubmitButton>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <Heading orgName={invite.orgName} role={role} />
      <JoinForm code={invite.code} initialError={error ? ERRORS[error] : undefined} />
    </Shell>
  );
}
