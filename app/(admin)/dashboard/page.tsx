import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Today" };

/** A1 Today board. The shell (rail, top bar) lives in app/(admin)/layout.tsx. */
export default async function DashboardPage() {
  const { profile } = await requireStaff();

  return (
    <>
      <PageHeader title="Today" />
      <p className="mt-3 text-body-lg text-steel">Signed in as {profile.full_name}. The board is next.</p>
    </>
  );
}
