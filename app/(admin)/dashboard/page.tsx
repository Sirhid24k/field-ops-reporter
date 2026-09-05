import type { Metadata } from "next";
import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Today" };

const NAV = ["Today", "Reports", "Alerts", "Digest", "Vehicles", "People", "Settings"];

/** Placeholder for A1 (Today board). Session 4 fills the content column; the rail layout stays. */
export default async function DashboardPage() {
  const { profile, organization } = await requireStaff();

  return (
    <div className="flex min-h-dvh flex-col min-[900px]:flex-row">
      <nav className="border-b border-line px-5 py-4 min-[900px]:w-60 min-[900px]:shrink-0 min-[900px]:border-r min-[900px]:border-b-0 min-[900px]:py-6">
        <p className="font-display text-heading font-bold">{organization.name}</p>
        <ul className="mt-4 flex gap-1 overflow-x-auto text-body-lg min-[900px]:mt-7 min-[900px]:flex-col">
          {NAV.map((item, index) => (
            <li
              key={item}
              className={
                index === 0 ? "rounded-control bg-ink/6 px-3 py-2.5 whitespace-nowrap" : "px-3 py-2.5 whitespace-nowrap text-steel"
              }
            >
              {item}
            </li>
          ))}
        </ul>
      </nav>

      <main className="flex w-full max-w-[1200px] flex-1 flex-col px-5 py-7 min-[900px]:px-8">
        <h1 className="font-display text-title font-bold">Today</h1>
        <p className="mt-3 text-body-lg">
          Signed in as {profile.full_name}, {profile.role}. The board arrives in session 4.
        </p>

        <div className="flex-1" />

        <form action={signOut} className="mt-8">
          <Button type="submit" variant="text">
            Sign out
          </Button>
        </form>
      </main>
    </div>
  );
}
