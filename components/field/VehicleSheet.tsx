"use client";

import { Sheet } from "@/components/ui";
import { cn } from "@/lib/cn";

export type VehicleOption = { id: string; plate_number: string; label: string | null };

export type VehicleSheetProps = {
  open: boolean;
  vehicles: VehicleOption[];
  selectedId: string | null;
  onSelect: (vehicleId: string) => void;
  onClose: () => void;
};

/** Bottom sheet for picking a vehicle when the org has more than one. 56px rows. */
export function VehicleSheet({ open, vehicles, selectedId, onSelect, onClose }: VehicleSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Vehicle">
      <ul>
        {vehicles.map((vehicle) => {
          const selected = vehicle.id === selectedId;
          return (
            <li key={vehicle.id}>
              <button
                type="button"
                onClick={() => onSelect(vehicle.id)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "-mx-4 flex min-h-14 w-[calc(100%+2rem)] items-center justify-between gap-4 border-b border-line px-4 text-left",
                  selected && "bg-ink/6",
                )}
              >
                <span className="font-display text-heading font-bold tabular">{vehicle.plate_number}</span>
                <span className="text-body text-steel">{selected ? "Selected" : vehicle.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
