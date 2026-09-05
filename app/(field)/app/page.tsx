import type { Metadata } from "next";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { firstName } from "@/lib/format";
import { roleLabel } from "@/lib/roles";

export const metadata: Metadata = { title: "Today" };

/** Placeholder for F2 (Today). Session 2 replaces the body; the header pattern stays. */
export default async function FieldHomePage() {
  const { profile, organization } = await requireMember();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-4 pt-6 pb-8">
      <header className="flex items-baseline justify-between text-caption text-steel">
        <span>{organization.name}</span>
        <span>{firstName(profile.full_name)}</span>
      </header>

      <h1 className="mt-7 font-display text-title font-bold">Signed in</h1>
      <p className="mt-3 text-body-lg">
        {profile.full_name}, {roleLabel(profile.role)}. Today&rsquo;s report screen arrives in session 2.
      </p>

      <div className="flex-1" />

      <form action={signOut}>
        <Button type="submit" variant="text">
          Sign out
        </Button>
      </form>
    </main>
  );
}
