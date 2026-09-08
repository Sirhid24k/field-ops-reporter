import type { Metadata } from "next";
import { PeopleTable, type PersonRow } from "@/components/admin/PeopleTable";
import { requireStaff } from "@/lib/auth";
import { formatDayShort } from "@/lib/dates";
import { humanize } from "@/lib/format";
import { roleLabel } from "@/lib/roles";

export const metadata: Metadata = { title: "People" };

type SearchParams = Promise<{ invite?: string }>;

/** A4 People tab. `?invite=1` opens the invite drawer (the board's empty state links here). */
export default async function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const { invite } = await searchParams;
  const { supabase, organization, profile } = await requireStaff();

  const { data: people, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, phone, active")
    .eq("org_id", organization.id)
    .order("active", { ascending: false })
    .order("role")
    .order("full_name");
  if (error) throw new Error(`Could not read people: ${error.message}`);

  const lastReports = await Promise.all(
    (people ?? []).map(async (person) => {
      if (person.role !== "field") return null;
      const { data } = await supabase
        .from("reports")
        .select("report_date")
        .eq("user_id", person.id)
        .order("report_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.report_date ?? null;
    }),
  );

  const rows: PersonRow[] = (people ?? []).map((person, index) => ({
    id: person.id,
    name: person.full_name,
    role: humanize(roleLabel(person.role)),
    phone: person.phone,
    lastReport: lastReports[index] ? formatDayShort(lastReports[index]) : null,
    active: person.active,
    isSelf: person.id === profile.id,
  }));

  return <PeopleTable rows={rows} openInvite={invite === "1"} />;
}
