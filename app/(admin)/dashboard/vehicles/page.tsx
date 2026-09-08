import type { Metadata } from "next";
import { VehiclesTable, type VehicleRow } from "@/components/admin/VehiclesTable";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Vehicles" };

/** A4 Vehicles tab. Reads as the signed-in supervisor; the table and drawer are client-side. */
export default async function VehiclesPage() {
  const { supabase, organization } = await requireStaff();

  const [{ data: vehicles, error }, { data: drivers }] = await Promise.all([
    supabase
      .from("vehicles")
      .select("id, plate_number, label, vehicle_type, default_driver_id, current_odometer, active, profiles!vehicles_default_driver_id_fkey(full_name)")
      .eq("org_id", organization.id)
      .order("active", { ascending: false })
      .order("plate_number"),
    supabase.from("profiles").select("id, full_name").eq("org_id", organization.id).eq("role", "field").eq("active", true).order("full_name"),
  ]);
  if (error) throw new Error(`Could not read vehicles: ${error.message}`);

  const rows: VehicleRow[] = (vehicles ?? []).map((vehicle) => ({
    id: vehicle.id,
    plate: vehicle.plate_number,
    label: vehicle.label,
    type: vehicle.vehicle_type,
    driverId: vehicle.default_driver_id,
    driver: vehicle.profiles?.full_name ?? null,
    odometer: vehicle.current_odometer,
    active: vehicle.active,
  }));

  return <VehiclesTable rows={rows} drivers={(drivers ?? []).map((driver) => ({ id: driver.id, name: driver.full_name }))} />;
}
