import { Tabs } from "./PageHeader";

/** The two tabs A4 shares between /dashboard/vehicles and /dashboard/people. */
export function VehiclesPeopleTabs({ active }: { active: "vehicles" | "people" }) {
  return (
    <Tabs
      label="Vehicles and people"
      items={[
        { href: "/dashboard/vehicles", label: "Vehicles", active: active === "vehicles" },
        { href: "/dashboard/people", label: "People", active: active === "people" },
      ]}
    />
  );
}
