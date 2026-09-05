import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClassName, SubmitButton, Button } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { inviteMessage, inviteUrl, whatsappShareUrl } from "@/lib/invites";
import { isStaff } from "@/lib/roles";
import { generateInvite, skipVehicle } from "./actions";
import { CopyLinkButton } from "./CopyLinkButton";
import { AddVehicleForm, CreateOrgForm } from "./forms";

export const metadata: Metadata = { title: "Set up" };

type SearchParams = Promise<{ step?: string }>;

/**
 * Three steps on one centered 560px column (design-brief §6).
 * The step comes from the profile state, not from the client: no profile means step 1;
 * with a profile, ?step=3 shows the invite and anything else shows the vehicle step.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const { step: stepParam } = await searchParams;
  const { supabase, user, profile, organization } = await getSession();
  if (!user) redirect("/signin?next=/onboarding");
  if (profile && !isStaff(profile.role)) redirect("/app");

  const step: 1 | 2 | 3 = !profile || !organization ? 1 : stepParam === "3" ? 3 : 2;

  let invite: { code: string } | null = null;
  if (step === 3 && organization) {
    const { data } = await supabase
      .from("invites")
      .select("code")
      .eq("org_id", organization.id)
      .eq("role", "field")
      .is("used_by", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    invite = data;
  }

  return (
    <main className="mx-auto w-full max-w-[560px] px-6 py-12">
      <p className="font-display text-body font-semibold text-steel tabular" aria-label={`Step ${step} of 3`}>
        {step} / 3
      </p>

      {step === 1 ? (
        <section>
          <h1 className="mt-4 font-display text-title font-bold">Name your business</h1>
          <CreateOrgForm />
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h1 className="mt-4 font-display text-title font-bold">Add your first vehicle</h1>
          <AddVehicleForm />
          <form action={skipVehicle} className="mt-4 text-center">
            <Button type="submit" variant="text" className="text-steel">
              Skip for now
            </Button>
          </form>
        </section>
      ) : null}

      {step === 3 && organization ? (
        <section>
          <h1 className="mt-4 font-display text-title font-bold">Invite a driver</h1>
          <p className="mt-2.5 text-body-lg text-steel">
            Send this link to the driver&rsquo;s phone. Role is fixed to driver.
          </p>

          {invite ? (
            <>
              <p className="mt-7 text-caption text-steel">Invite link</p>
              <p className="mt-1.5 select-all rounded-control border border-line bg-ink/6 px-3 py-3 text-body break-all">
                {inviteUrl(invite.code)}
              </p>
              <p className="mt-1.5 text-caption text-steel">Works once, for 7 days.</p>
              <div className="mt-4 flex gap-3">
                <CopyLinkButton link={inviteUrl(invite.code)} />
                <a
                  href={whatsappShareUrl(inviteMessage(organization.name, "field", invite.code))}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName({ variant: "secondary", block: true })}
                >
                  Share on WhatsApp
                </a>
              </div>
              <Link href="/dashboard" className={cn(buttonClassName({ variant: "primary", block: true }), "mt-8")}>
                Go to Today
              </Link>
            </>
          ) : (
            <form action={generateInvite} className="mt-7">
              <SubmitButton loadingLabel="Generating…" block>
                Generate link
              </SubmitButton>
            </form>
          )}
        </section>
      ) : null}
    </main>
  );
}
