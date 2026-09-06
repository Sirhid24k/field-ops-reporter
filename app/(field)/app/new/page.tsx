import type { Metadata } from "next";
import { BackHeader, Screen } from "@/components/field/Frame";
import { NewReportForm } from "@/components/field/NewReportForm";
import { requireMember } from "@/lib/auth";

export const metadata: Metadata = { title: "New report" };

/** F3 — New report. */
export default async function NewReportPage() {
  const { supabase, profile, organization } = await requireMember();
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, plate_number, label, default_driver_id")
    .eq("org_id", organization.id)
    .eq("active", true)
    .order("created_at");

  const list = vehicles ?? [];
  const defaultVehicleId = list.find((vehicle) => vehicle.default_driver_id === profile.id)?.id ?? list[0]?.id ?? null;

  return (
    <Screen>
      <BackHeader title="New report" />
      <NewReportForm
        vehicles={list.map(({ id, plate_number, label }) => ({ id, plate_number, label }))}
        defaultVehicleId={defaultVehicleId}
        timezone={organization.timezone}
      />
    </Screen>
  );
}
