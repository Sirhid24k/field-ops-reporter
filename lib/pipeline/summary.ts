import { formatGrouped } from "@/lib/format";

/**
 * The one-line `summary` the office and the driver see on a report, assembled from the
 * promoted fields in code (no model call): "Kaduna to Kano with 30 t of cement, 214 km,
 * 48 L of fuel bought for ₦52 000. No incidents."
 */

export type SummaryFields = {
  tripStatus: string | null;
  origin: string | null;
  destination: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  fuelLiters: number | null;
  fuelCostNgn: number | null;
  loadType: string | null;
  loadTonnage: number | null;
  incidents: Array<{ type: string }>;
};

const TRIP_PHRASES: Record<string, string> = {
  completed: "Trip completed",
  in_progress: "Trip in progress",
  not_started: "Trip not started",
  blocked: "Trip blocked",
};

export function summarize(fields: SummaryFields): string {
  const route = fields.origin && fields.destination
    ? `${fields.origin} to ${fields.destination}`
    : fields.destination
      ? `To ${fields.destination}`
      : fields.origin
        ? `From ${fields.origin}`
        : (TRIP_PHRASES[fields.tripStatus ?? ""] ?? "Report received");

  const tonnage = fields.loadTonnage !== null ? `${formatGrouped(fields.loadTonnage, { maximumFractionDigits: 1 })} t` : null;
  const load = fields.loadType && tonnage
    ? ` with ${tonnage} of ${fields.loadType.toLowerCase()}`
    : fields.loadType
      ? ` with ${fields.loadType.toLowerCase()}`
      : tonnage
        ? ` with ${tonnage}`
        : "";

  const details: string[] = [];
  if (fields.odometerStart !== null && fields.odometerEnd !== null) {
    details.push(`${formatGrouped(fields.odometerEnd - fields.odometerStart)} km`);
  } else if (fields.odometerEnd !== null) {
    details.push(`odometer ${formatGrouped(fields.odometerEnd)}`);
  }
  if (fields.fuelLiters !== null && fields.fuelCostNgn !== null) {
    details.push(`${formatGrouped(fields.fuelLiters, { maximumFractionDigits: 1 })} L of fuel bought for ₦${formatGrouped(fields.fuelCostNgn)}`);
  } else if (fields.fuelLiters !== null) {
    details.push(`${formatGrouped(fields.fuelLiters, { maximumFractionDigits: 1 })} L of fuel`);
  } else if (fields.fuelCostNgn !== null) {
    details.push(`fuel for ₦${formatGrouped(fields.fuelCostNgn)}`);
  }

  const first = `${route}${load}${details.length > 0 ? `, ${details.join(", ")}` : ""}.`;
  const count = fields.incidents.length;
  const second = count === 0
    ? "No incidents."
    : count === 1
      ? `1 incident: ${fields.incidents[0].type}.`
      : `${count} incidents: ${fields.incidents.map((incident) => incident.type).join(", ")}.`;
  return `${first} ${second}`;
}
