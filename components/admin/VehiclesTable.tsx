"use client";

import { useActionState, useEffect, useState } from "react";
import { saveVehicle, setVehicleActive } from "@/app/(admin)/dashboard/vehicles/actions";
import { Button, Drawer, Input, Select, SubmitButton } from "@/components/ui";
import type { FormState } from "@/lib/forms";
import { formatGrouped } from "@/lib/format";
import { ActiveToggle } from "./ActiveToggle";
import { PageHeader } from "./PageHeader";
import { VehiclesPeopleTabs } from "./VehiclesPeopleTabs";

export type VehicleRow = {
  id: string;
  plate: string;
  label: string | null;
  type: string | null;
  driverId: string | null;
  driver: string | null;
  odometer: number | null;
  active: boolean;
};

export type DriverOption = { id: string; name: string };

/**
 * A4 Vehicles: plate, label, type, driver, current odometer in tabular digits, active
 * toggle; Add vehicle and row click open the same right-hand drawer (never a modal).
 */
export function VehiclesTable({ rows, drivers }: { rows: VehicleRow[]; drivers: DriverOption[] }) {
  const [drawer, setDrawer] = useState<{ open: boolean; vehicle: VehicleRow | null }>({ open: false, vehicle: null });

  const head = "px-3 py-2 text-left text-caption font-normal text-steel first:pl-2 last:pr-2";
  const cell = "px-3 py-2 first:pl-2 last:pr-2";

  return (
    <>
      <PageHeader
        title="Vehicles and people"
        beside={<VehiclesPeopleTabs active="vehicles" />}
        actions={<Button onClick={() => setDrawer({ open: true, vehicle: null })}>Add vehicle</Button>}
      />

      {rows.length === 0 ? (
        <p className="mt-8 max-w-[60ch] text-body-lg">No vehicles yet. Add the first one and it appears on the board.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={head}>Plate</th>
                <th className={head}>Label</th>
                <th className={head}>Type</th>
                <th className={head}>Driver</th>
                <th className={`${head} text-right`}>Current odometer</th>
                <th className={head}>Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="h-12 cursor-pointer border-b border-line hover:bg-ink/6"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("button, a, input")) return;
                    setDrawer({ open: true, vehicle: row });
                  }}
                >
                  <td className={cell}>
                    <button type="button" onClick={() => setDrawer({ open: true, vehicle: row })} className="font-display text-body-lg font-bold tabular hover:underline hover:underline-offset-4">
                      {row.plate}
                    </button>
                  </td>
                  <td className={cell}>{row.label ?? <span className="text-steel">—</span>}</td>
                  <td className={cell}>{row.type ?? <span className="text-steel">—</span>}</td>
                  <td className={cell}>{row.driver ?? <span className="text-steel">—</span>}</td>
                  <td className={`${cell} text-right font-display text-body-lg font-semibold tabular`}>
                    {row.odometer !== null ? formatGrouped(row.odometer) : <span className="font-body text-body font-normal text-steel">—</span>}
                  </td>
                  <td className={cell}>
                    <ActiveToggle active={row.active} label={row.plate} onToggle={(active) => setVehicleActive({ vehicleId: row.id, active })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={drawer.open} onClose={() => setDrawer({ open: false, vehicle: null })} title={drawer.vehicle ? "Edit vehicle" : "Add vehicle"}>
        {drawer.open ? (
          <VehicleForm key={drawer.vehicle?.id ?? "new"} vehicle={drawer.vehicle} drivers={drivers} onSaved={() => setDrawer({ open: false, vehicle: null })} />
        ) : null}
      </Drawer>
    </>
  );
}

function VehicleForm({ vehicle, drivers, onSaved }: { vehicle: VehicleRow | null; drivers: DriverOption[]; onSaved: () => void }) {
  const [state, action] = useActionState<FormState, FormData>(saveVehicle, undefined);

  useEffect(() => {
    if (state?.done) onSaved();
  }, [state, onSaved]);

  return (
    <form action={action} noValidate className="space-y-5">
      <input type="hidden" name="vehicleId" value={vehicle?.id ?? ""} />
      <Input
        name="plate"
        label="Plate"
        placeholder="KTU 421 XA"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        required
        autoFocus
        inputClassName="font-display font-bold tabular uppercase"
        defaultValue={state?.values?.plate ?? vehicle?.plate ?? ""}
        error={state?.fieldErrors?.plate}
      />
      <Input name="label" label="Label" placeholder="Sinotruk tipper" defaultValue={state?.values?.label ?? vehicle?.label ?? ""} error={state?.fieldErrors?.label} />
      <Input name="vehicleType" label="Type" placeholder="Tipper, tanker, flatbed…" defaultValue={state?.values?.vehicleType ?? vehicle?.type ?? ""} error={state?.fieldErrors?.vehicleType} />
      <Select name="driverId" label="Driver" defaultValue={state?.values?.driverId ?? vehicle?.driverId ?? ""} error={state?.fieldErrors?.driverId} hint="The driver this vehicle is offered to first on their phone.">
        <option value="">No usual driver</option>
        {drivers.map((driver) => (
          <option key={driver.id} value={driver.id}>
            {driver.name}
          </option>
        ))}
      </Select>
      <Input
        name="odometer"
        label="Current odometer"
        placeholder="184 220"
        inputMode="numeric"
        autoComplete="off"
        inputClassName="font-display font-bold tabular"
        hint="Kilometres on the dashboard now. Approving a report moves it forward."
        defaultValue={state?.values?.odometer ?? (vehicle?.odometer !== null && vehicle?.odometer !== undefined ? String(vehicle.odometer) : "")}
        error={state?.fieldErrors?.odometer}
      />
      {state?.error ? (
        <p role="alert" className="border-l-4 border-flag pl-3 text-body text-flag">
          {state.error}
        </p>
      ) : null}
      <SubmitButton loadingLabel="Saving…" block className="mt-3">
        {vehicle ? "Save" : "Add vehicle"}
      </SubmitButton>
    </form>
  );
}
