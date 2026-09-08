import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { AdminNav } from "@/components/admin/AdminNav";
import { Button } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

/**
 * The admin shell (design-brief §3 and §7): a 240px rail with text labels, the content
 * column at most 1200px wide, and below 900px the rail becomes a top bar. Every page under
 * /dashboard runs as a staff member of one organisation; RLS scopes every read and write.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { supabase, organization } = await requireStaff();

  // the small flag-coloured number beside "Alerts" in the rail
  const { count } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("org_id", organization.id)
    .eq("status", "open");

  return (
    <div className="flex min-h-dvh flex-col min-[900px]:flex-row">
      <AdminNav
        orgName={organization.name}
        openAlerts={count ?? 0}
        signOut={
          <form action={signOut}>
            <Button type="submit" variant="text" className="text-steel">
              Sign out
            </Button>
          </form>
        }
      />
      <main className="w-full min-w-0 max-w-[1200px] flex-1 px-4 py-6 min-[900px]:px-8 min-[900px]:py-7">{children}</main>
    </div>
  );
}
