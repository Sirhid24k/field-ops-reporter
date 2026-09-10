// Seeds the demo organisation so the product looks alive: four accounts, five vehicles,
// twelve days of approved history, today's board in every state, and three past digests.
//
//   npm run seed            create or replace the seeded rows
//   npm run seed -- --wipe  remove every seeded row (and the seeded accounts) and stop
//
// Ownership rules (the tag is the boundary):
//   - Runs with the service role and adopts an EXISTING organisation: SEED_ORG_ID, else the one
//     organisation named "Demo Haulage Ltd", else the only organisation in the project. It never
//     creates one and refuses when the choice is ambiguous.
//   - Every row it writes carries seed_tag = 'demo-v1'. A re-run deletes only tagged reports,
//     alerts, clarifications, digests and invites, then recreates them; accounts and vehicles are
//     upserted so sessions on signed-in phones survive and vehicle ids stay stable.
//   - Rows without the tag (the hand-made admin, real drivers, real vehicles and everything
//     attached to them) are snapshotted before and compared after; any difference other than the
//     two allowed writes (the real vehicle's odometer from SEED_REAL_ODOMETER, and the org's fuel
//     baseline) makes the script exit 1.
//   - Seeded reports carry no audio (nothing is uploaded to storage); the transcript and the
//     extracted fields are what the pipeline would have produced, and the checks, alerts, summary
//     and clarification questions come from the same lib/pipeline functions the pipeline runs.
//
// Environment (.env.local): SEED_ORG_ID (recommended), SEED_EMAIL_BASE (me@gmail.com →
// me+musa@gmail.com …), SEED_REAL_PLATE (default T-25783-LA) and SEED_REAL_ODOMETER.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env"; // named import: this .ts script runs as CommonJS under tsx
import { formatDayShort, shiftDate } from "../lib/dates";
import { formatGrouped, formatTime12h } from "../lib/format";
import { decideClarification } from "../lib/pipeline/clarify";
import { toJson } from "../lib/pipeline/db";
import { collectDigestData, cutoffMinutes, localClock, renderDigestFallback, utcRangeForLocalDay, type DigestOrg } from "../lib/pipeline/digest";
import { extractionSchema, promotedColumns, type Extraction } from "../lib/pipeline/extract";
import { summarize } from "../lib/pipeline/summary";
import { missingReportAlert, validateReport, type Incident, type ValidationInput } from "../lib/pipeline/validate";
import type { Database, TablesInsert } from "../lib/supabase/types";

loadEnvConfig(process.cwd(), true);

export const SEED_TAG = "demo-v1";
const HISTORY_DAYS = 12;
const DIGEST_DAYS = 3;
const DEFAULT_ORG_NAME = "Demo Haulage Ltd";
const DEMO_CUTOFF = "20:00";

type Db = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];

// ---------------------------------------------------------------------------
// the cast
// ---------------------------------------------------------------------------

type PersonKey = "musa" | "ibrahim" | "yusuf" | "supervisor";

const PEOPLE: ReadonlyArray<{ key: PersonKey; name: string; role: Role; phone: string }> = [
  { key: "musa", name: "Musa Abdullahi", role: "field", phone: "0803 555 0101" },
  { key: "ibrahim", name: "Ibrahim Sani", role: "field", phone: "0805 555 0102" },
  { key: "yusuf", name: "Yusuf Bello", role: "field", phone: "0806 555 0103" },
  { key: "supervisor", name: "Ngozi Eze", role: "supervisor", phone: "0802 555 0100" },
];

type Route = { from: string; to: string; km: number; place: string };
type Load = { type: string; min: number; max: number };

type VehicleSpec = {
  plate: string;
  label: string;
  type: string;
  driver: PersonKey;
  /** The opening odometer the admin entered when the vehicle was added. */
  opening: number;
  routes: Route[];
  loads: Load[];
  /** Days (offsets back from today) without a report. */
  gaps: number[];
};

const TIPPER_LOADS: Load[] = [
  { type: "Gravel", min: 18, max: 30 },
  { type: "Sand", min: 15, max: 28 },
  { type: "Granite chippings", min: 20, max: 30 },
  { type: "Laterite", min: 16, max: 26 },
];
const FLATBED_LOADS: Load[] = [
  { type: "Iron rods", min: 18, max: 28 },
  { type: "Cement", min: 20, max: 30 },
  { type: "Roofing sheets", min: 12, max: 20 },
];
const TANKER_LOADS: Load[] = [
  { type: "Diesel", min: 27, max: 33 },
  { type: "Petrol", min: 26, max: 32 },
];
const BOX_LOADS: Load[] = [
  { type: "Rice", min: 12, max: 20 },
  { type: "Fertiliser", min: 14, max: 22 },
  { type: "Cartons of drinks", min: 10, max: 16 },
];

const VEHICLES: readonly VehicleSpec[] = [
  {
    plate: "KTU 421 XA",
    label: "Sinotruk tipper",
    type: "tipper",
    driver: "musa",
    opening: 184_120,
    routes: [
      { from: "Kaduna", to: "Kano", km: 215, place: "Zaria" },
      { from: "Kano", to: "Kaduna", km: 215, place: "Zaria" },
      { from: "Zaria", to: "Abuja", km: 245, place: "Kaduna toll gate" },
      { from: "Abuja", to: "Kaduna", km: 190, place: "Jere" },
      { from: "Kaduna", to: "Abuja", km: 190, place: "Jere" },
    ],
    loads: TIPPER_LOADS,
    gaps: [],
  },
  {
    plate: "KJA 118 BC",
    label: "Mack flatbed",
    type: "flatbed",
    driver: "ibrahim",
    opening: 302_450,
    routes: [
      { from: "Lagos", to: "Ibadan", km: 130, place: "Sagamu interchange" },
      { from: "Ibadan", to: "Lagos", km: 130, place: "Sagamu interchange" },
      { from: "Lagos", to: "Abeokuta", km: 80, place: "Ifo" },
      { from: "Ibadan", to: "Ilorin", km: 155, place: "Ogbomosho" },
      { from: "Ilorin", to: "Ibadan", km: 155, place: "Ogbomosho" },
    ],
    loads: FLATBED_LOADS,
    gaps: [],
  },
  {
    plate: "ABJ 902 KW",
    label: "Howo tanker",
    type: "tanker",
    driver: "yusuf",
    opening: 97_380,
    routes: [
      { from: "Abuja", to: "Lokoja", km: 165, place: "Gwagwalada" },
      { from: "Lokoja", to: "Minna", km: 290, place: "Koton Karfe" },
      { from: "Minna", to: "Abuja", km: 130, place: "Suleja" },
      { from: "Abuja", to: "Minna", km: 130, place: "Suleja" },
      { from: "Abuja", to: "Zaria", km: 245, place: "Kaduna toll gate" },
    ],
    loads: TANKER_LOADS,
    gaps: [10],
  },
  {
    plate: "GWA 330 XY",
    label: "Iveco tipper",
    type: "tipper",
    driver: "musa",
    opening: 251_900,
    routes: [
      { from: "Jos", to: "Bauchi", km: 130, place: "Toro" },
      { from: "Bauchi", to: "Jos", km: 130, place: "Toro" },
      { from: "Jos", to: "Abuja", km: 280, place: "Akwanga" },
      { from: "Abuja", to: "Jos", km: 280, place: "Akwanga" },
      { from: "Minna", to: "Abuja", km: 130, place: "Suleja" },
    ],
    loads: TIPPER_LOADS,
    gaps: [5, 9],
  },
  {
    plate: "KNO 774 AA",
    label: "MAN box truck",
    type: "box truck",
    driver: "ibrahim",
    opening: 128_640,
    routes: [
      { from: "Kano", to: "Katsina", km: 165, place: "Danja" },
      { from: "Katsina", to: "Kano", km: 165, place: "Danja" },
      { from: "Kano", to: "Zaria", km: 80, place: "Kwanar Dangora" },
      { from: "Zaria", to: "Kano", km: 80, place: "Kwanar Dangora" },
      { from: "Kano", to: "Kaduna", km: 215, place: "Zaria" },
    ],
    loads: BOX_LOADS,
    gaps: [3, 7],
  },
];

/** Today's board (wireframe 1j): one vehicle per state; the real truck is the live sixth row. */
const TODAY: Record<string, "approved" | "ready" | "needs_answer" | "not_reported" | "fuel_outlier"> = {
  "KTU 421 XA": "approved",
  "KJA 118 BC": "ready",
  "ABJ 902 KW": "needs_answer",
  "GWA 330 XY": "not_reported",
  "KNO 774 AA": "fuel_outlier",
};
/** The acknowledged breakdown alert from two days ago lives on this vehicle's report. */
const BREAKDOWN = { plate: "KJA 118 BC", daysAgo: 2 };

// ---------------------------------------------------------------------------
// deterministic randomness (same history for the same day, so a re-run is a replace)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

class Rng {
  private readonly next: () => number;
  constructor(seed: string) {
    this.next = mulberry32(hash(seed));
  }
  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}

// ---------------------------------------------------------------------------
// trips: the numbers first, so the org baseline can be computed before the checks run
// ---------------------------------------------------------------------------

type Fuel = { liters: number; price: number | null; total: number | null };

type Trip = {
  spec: VehicleSpec;
  date: string;
  daysAgo: number;
  source: "voice" | "text";
  language: "Pidgin" | "English";
  route: Route;
  km: number;
  start: number;
  end: number;
  bothReadings: boolean;
  /** The driver said the reading but it could not be read: the field stays null and a question is asked. */
  unclearOdometer: boolean;
  fuel: Fuel | null;
  load: { type: string; tonnes: number };
  incidents: Incident[];
  note: string | null;
  lastOdometer: number;
  daysSinceLast: number;
  outcome: "reviewed" | "ready" | "needs_clarification";
  submittedAt: string;
  processedAt: string;
  reviewedAt: string | null;
};

type Clock = { timezone: string; today: string; nowMs: number };

function dayStartMs(clock: Clock, date: string): number {
  return new Date(utcRangeForLocalDay(date, clock.timezone).start).getTime();
}

function atLocal(clock: Clock, date: string, minutes: number, seconds = 0): string {
  return new Date(dayStartMs(clock, date) + minutes * 60_000 + seconds * 1_000).toISOString();
}

function clampMs(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function fuelFor(rng: Rng, km: number): Fuel {
  const kmPerL = rng.float(4.2, 5.8);
  const liters = Math.max(20, Math.round(km / kmPerL));
  const price = 1_650 + 10 * rng.int(0, 20);
  // one driver in five states the total instead of the price per litre
  return rng.chance(0.2) ? { liters, price: null, total: liters * price } : { liters, price, total: null };
}

function incidentFor(rng: Rng, route: Route): Incident | null {
  if (!rng.chance(0.08)) return null;
  return rng.chance(0.6)
    ? { type: "checkpoint", severity: "low", description: `Police checkpoint near ${route.place}, about thirty minutes lost.` }
    : { type: "delay", severity: "low", description: `Heavy traffic at ${route.place}, about an hour lost.` };
}

function noteFor(rng: Rng, route: Route): string | null {
  if (!rng.chance(0.25)) return null;
  return rng.pick([
    `Road after ${route.place} is bad, we took it slowly.`,
    `Offloading at ${route.to} took long, the site had no forklift.`,
    `Tyre pressure low on the rear left, checked at ${route.place}.`,
    `Customer at ${route.to} wants the next load on Friday.`,
  ]);
}

function generateTrips(clock: Clock): Trip[] {
  const rng = new Rng(`${SEED_TAG}:${clock.today}`);
  const trips: Trip[] = [];
  const lastEnd = new Map<string, number>();
  const lastDate = new Map<string, string | null>();

  const baseTrip = (spec: VehicleSpec, date: string, daysAgo: number): Omit<Trip, "outcome" | "submittedAt" | "processedAt" | "reviewedAt"> => {
    const route = rng.pick(spec.routes);
    const km = route.km + rng.int(-12, 18);
    const start = lastEnd.get(spec.plate) ?? spec.opening;
    const end = start + km;
    const previous = lastDate.get(spec.plate) ?? null;
    const daysSinceLast = previous ? Math.max(1, Math.round((Date.parse(date) - Date.parse(previous)) / 86_400_000)) : 1;
    const load = rng.pick(spec.loads);
    const source: Trip["source"] = rng.chance(0.3) ? "text" : "voice";
    return {
      spec,
      date,
      daysAgo,
      source,
      language: rng.chance(0.6) ? "Pidgin" : "English",
      route,
      km,
      start,
      end,
      bothReadings: rng.chance(0.3),
      unclearOdometer: false,
      fuel: rng.chance(0.75) ? fuelFor(rng, km) : null,
      load: { type: load.type, tonnes: rng.int(load.min, load.max) },
      incidents: [incidentFor(rng, route)].filter((incident): incident is Incident => incident !== null),
      note: noteFor(rng, route),
      lastOdometer: start,
      daysSinceLast,
    };
  };

  const advance = (trip: Pick<Trip, "spec" | "date" | "end" | "outcome">) => {
    if (trip.outcome === "reviewed") lastEnd.set(trip.spec.plate, trip.end);
    lastDate.set(trip.spec.plate, trip.date);
  };

  // twelve days of approved history, newest last
  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
    const date = shiftDate(clock.today, -daysAgo);
    for (const spec of VEHICLES) {
      if (spec.gaps.includes(daysAgo)) continue;
      const base = baseTrip(spec, date, daysAgo);
      if (spec.plate === BREAKDOWN.plate && daysAgo === BREAKDOWN.daysAgo) {
        base.incidents = [{ type: "breakdown", severity: "medium", description: `Gearbox failed near ${base.route.place}; a mechanic fixed it after two hours.` }];
        base.language = "Pidgin";
        base.source = "voice";
      }
      const submittedMin = rng.int(16 * 60 + 20, 19 * 60 + 50);
      const submittedAt = atLocal(clock, date, submittedMin);
      const processedAt = atLocal(clock, date, submittedMin, rng.int(18, 40));
      // approved the same evening, or the next morning
      const reviewedAt = rng.chance(0.6)
        ? atLocal(clock, date, submittedMin + rng.int(30, 150))
        : atLocal(clock, shiftDate(date, 1), rng.int(7 * 60 + 30, 9 * 60 + 30));
      const trip: Trip = { ...base, outcome: "reviewed", submittedAt, processedAt, reviewedAt };
      trips.push(trip);
      advance(trip);
    }
  }

  // today: one vehicle per state
  const todayStart = dayStartMs(clock, clock.today);
  const stamp = (minutesAgo: number, offsetSeconds = 0) =>
    new Date(clampMs(clock.nowMs - minutesAgo * 60_000 + offsetSeconds * 1_000, todayStart + 5 * 60_000, clock.nowMs - 30_000)).toISOString();

  for (const spec of VEHICLES) {
    const state = TODAY[spec.plate];
    if (state === "not_reported") continue;
    const base = baseTrip(spec, clock.today, 0);
    base.source = "voice";

    if (state === "approved") {
      const trip: Trip = { ...base, outcome: "reviewed", submittedAt: stamp(110), processedAt: stamp(110, 24), reviewedAt: stamp(85) };
      trips.push(trip);
      advance(trip);
    } else if (state === "ready") {
      const trip: Trip = { ...base, bothReadings: false, outcome: "ready", submittedAt: stamp(48), processedAt: stamp(48, 21), reviewedAt: null };
      trips.push(trip);
      advance(trip);
    } else if (state === "needs_answer") {
      const fuel = fuelFor(rng, base.km);
      const trip: Trip = {
        ...base,
        language: "Pidgin",
        bothReadings: false,
        unclearOdometer: true,
        fuel: { liters: fuel.liters, price: fuel.price ?? 1_760, total: null },
        incidents: [],
        note: null,
        outcome: "needs_clarification",
        submittedAt: stamp(31),
        processedAt: stamp(31, 26),
        reviewedAt: null,
      };
      trips.push(trip);
      advance(trip);
    } else if (state === "fuel_outlier") {
      // 165-odd km on 150 litres: about 1 km/L against a baseline near 5
      const trip: Trip = {
        ...base,
        language: "Pidgin",
        bothReadings: false,
        fuel: { liters: 150, price: 1_780, total: null },
        incidents: [],
        outcome: "ready",
        submittedAt: stamp(62),
        processedAt: stamp(62, 23),
        reviewedAt: null,
      };
      trips.push(trip);
      advance(trip);
    }
  }

  return trips;
}

/** Median km/L over the approved history with fuel, rounded to one decimal: the org's fuel baseline. */
function fuelBaseline(trips: Trip[]): number | null {
  const samples = trips
    .filter((trip) => trip.outcome === "reviewed" && trip.daysAgo > 0 && trip.fuel !== null)
    .map((trip) => trip.km / (trip.fuel as Fuel).liters)
    .sort((a, b) => a - b);
  if (samples.length === 0) return null;
  const middle = Math.floor(samples.length / 2);
  const median = samples.length % 2 === 1 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2;
  return Math.round(median * 10) / 10;
}

// ---------------------------------------------------------------------------
// what the driver said
// ---------------------------------------------------------------------------

const spoken = (n: number) => n.toLocaleString("en-US");

function transcriptFor(trip: Trip, driverName: string): string {
  const first = driverName.split(/\s+/)[0];
  const { route, load, fuel } = trip;
  const loadWord = load.type.toLowerCase();

  if (trip.source === "text") {
    const parts = [`${route.from} to ${route.to}, ${loadWord} ${load.tonnes}t.`];
    parts.push(trip.bothReadings ? `Odometer ${trip.start} to ${trip.end}.` : `Odometer ${trip.end}.`);
    if (fuel) parts.push(fuel.total !== null ? `Fuel ${fuel.liters}L, ${spoken(fuel.total)} total.` : `Fuel ${fuel.liters}L at ${spoken(fuel.price as number)}.`);
    else parts.push("No fuel.");
    for (const incident of trip.incidents) parts.push(incident.description);
    if (trip.note) parts.push(trip.note);
    return parts.join(" ");
  }

  if (trip.language === "Pidgin") {
    const parts = [`Oga, na ${first}.`];
    parts.push(`Today we carry ${loadWord} from ${route.from} go ${route.to}, ${load.tonnes} tonnes, we don deliver am.`);
    if (trip.unclearOdometer) {
      parts.push(`Odometer... the meter read ${String(trip.end).slice(0, 2)}... eh, ${String(trip.end).slice(0, 3)}, nine... the number no too clear for the screen, I go check am again.`);
    } else if (trip.bothReadings) {
      parts.push(`We start for ${spoken(trip.start)}, we stop for ${spoken(trip.end)}.`);
    } else {
      parts.push(`Odometer na ${spoken(trip.end)} when we park.`);
    }
    if (fuel) {
      parts.push(
        fuel.total !== null
          ? `Fuel cost us ${spoken(fuel.total)} naira for ${fuel.liters} litres.`
          : `We buy fuel ${fuel.liters} litres for ${spoken(fuel.price as number)} naira per litre.`,
      );
    } else {
      parts.push("We no buy fuel today.");
    }
    for (const incident of trip.incidents) {
      if (incident.type === "breakdown") parts.push(`Motor spoil near ${route.place}, gearbox no gree. Mechanic fix am, we lose like two hours.`);
      else if (incident.type === "checkpoint") parts.push(`Police stop us for checkpoint near ${route.place}, small delay, like thirty minutes.`);
      else parts.push(`Go-slow for ${route.place}, we lose one hour.`);
    }
    parts.push(trip.note ?? "No wahala.");
    return parts.join(" ");
  }

  const parts = [`Good evening, this is ${first}.`];
  parts.push(`We moved ${loadWord}, ${load.tonnes} tonnes, from ${route.from} to ${route.to} and delivered.`);
  parts.push(trip.bothReadings ? `Started at ${spoken(trip.start)}, ended at ${spoken(trip.end)}.` : `The odometer reading is ${spoken(trip.end)}.`);
  if (fuel) {
    parts.push(
      fuel.total !== null
        ? `Fuel was ${spoken(fuel.total)} naira for ${fuel.liters} litres.`
        : `Bought ${fuel.liters} litres of diesel at ${spoken(fuel.price as number)} naira per litre.`,
    );
  } else {
    parts.push("No fuel bought today.");
  }
  for (const incident of trip.incidents) parts.push(incident.description);
  parts.push(trip.note ?? "No problems.");
  return parts.join(" ");
}

/** The record the extraction model would have produced from that transcript (spec §6, through the same zod schema). */
function extractionFor(trip: Trip): Extraction {
  const fuel = trip.fuel;
  const question = trip.language === "Pidgin" ? `Abeg, wetin be the odometer reading when you reach ${trip.route.to}?` : `What did the odometer read when you reached ${trip.route.to}?`;
  const raw = {
    report_date: trip.date,
    trip_status: "completed",
    origin: trip.route.from,
    destination: trip.route.to,
    waypoints: [],
    load_type: trip.load.type,
    load_tonnage: trip.load.tonnes,
    odometer_start: trip.bothReadings ? trip.start : null,
    odometer_end: trip.unclearOdometer ? null : trip.end,
    fuel_liters: fuel?.liters ?? null,
    fuel_price_per_l_ngn: fuel?.price ?? null,
    fuel_cost_ngn: fuel?.total ?? null,
    expenses: [],
    incidents: trip.incidents,
    notes: trip.note,
    transcript_language: trip.source === "voice" ? trip.language : null,
    confidence: {
      report_date: 1,
      trip_status: 0.95,
      origin: 0.95,
      destination: 0.95,
      waypoints: 0,
      load_type: 0.9,
      load_tonnage: 0.85,
      odometer_start: trip.bothReadings ? 0.9 : 0,
      odometer_end: trip.unclearOdometer ? 0.3 : 0.92,
      fuel_liters: fuel ? 0.9 : 0,
      fuel_price_per_l_ngn: fuel?.price !== null && fuel ? 0.88 : 0,
      fuel_cost_ngn: fuel?.total !== null && fuel ? 0.85 : 0,
      expenses: 0,
      incidents: trip.incidents.length > 0 ? 0.9 : 0,
      notes: trip.note ? 0.8 : 0,
    },
    missing_fields: trip.unclearOdometer ? ["odometer_end"] : [],
    clarifying_questions: trip.unclearOdometer ? [question] : [],
  };
  return extractionSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

type Ids = { orgId: string; vehicleIds: Map<string, string>; profileIds: Map<PersonKey, string> };

type Built = {
  report: TablesInsert<"reports">;
  alerts: TablesInsert<"alerts">[];
  clarifications: TablesInsert<"clarifications">[];
};

/** Mirrors lib/pipeline/process.ts (extract → promote → validate → clarify) for one trip. */
function buildRows(trip: Trip, baseline: number | null, ids: Ids): Built {
  const driverKey = trip.spec.driver;
  const driverName = PEOPLE.find((person) => person.key === driverKey)?.name ?? "Driver";
  const supervisorId = ids.profileIds.get("supervisor") as string;
  const vehicleId = ids.vehicleIds.get(trip.spec.plate) as string;
  const reportId = randomUUID();

  const transcript = transcriptFor(trip, driverName);
  const extraction = extractionFor(trip);
  const promoted = promotedColumns(extraction);
  if (promoted.odometer_start === null && promoted.odometer_end !== null && trip.lastOdometer <= promoted.odometer_end) {
    promoted.odometer_start = trip.lastOdometer; // the pipeline's fill-in from the last approved reading
  }

  const input: ValidationInput = {
    odometerStart: extraction.odometer_start,
    odometerEnd: extraction.odometer_end,
    fuelLiters: extraction.fuel_liters,
    fuelCostNgn: promoted.fuel_cost_ngn,
    loadTonnage: extraction.load_tonnage,
    incidents: extraction.incidents,
    lastOdometer: trip.lastOdometer,
    daysSinceLastOdometer: trip.daysSinceLast,
    fuelBaselineKmPerL: baseline,
    hasDuplicate: false,
  };
  const verdict = validateReport(input);
  const decision = decideClarification(extraction, 0);

  const status: Trip["outcome"] = trip.outcome === "needs_clarification" && !decision.ask ? "ready" : trip.outcome;
  const statusChangedAt = trip.reviewedAt ?? trip.processedAt;

  const report: TablesInsert<"reports"> = {
    id: reportId,
    client_uuid: randomUUID(),
    org_id: ids.orgId,
    user_id: ids.profileIds.get(driverKey) as string,
    vehicle_id: vehicleId,
    report_date: trip.date,
    status,
    source: trip.source,
    audio_path: null,
    audio_duration_s: trip.source === "voice" ? 18 + (transcript.length % 27) : null,
    typed_note: trip.source === "text" ? transcript : null,
    transcript,
    transcript_language: trip.source === "voice" ? trip.language : null,
    ...promoted,
    extracted: toJson(extraction),
    confidence: toJson(extraction.confidence),
    validation: toJson(verdict.results),
    summary: summarize({
      tripStatus: extraction.trip_status,
      origin: extraction.origin,
      destination: extraction.destination,
      odometerStart: promoted.odometer_start,
      odometerEnd: extraction.odometer_end,
      fuelLiters: extraction.fuel_liters,
      fuelCostNgn: promoted.fuel_cost_ngn,
      loadType: extraction.load_type,
      loadTonnage: extraction.load_tonnage,
      incidents: extraction.incidents,
    }),
    error: null,
    submitted_at: trip.submittedAt,
    processed_at: trip.processedAt,
    status_changed_at: statusChangedAt,
    requeue_count: 0,
    reviewed_by: status === "reviewed" ? supervisorId : null,
    reviewed_at: status === "reviewed" ? trip.reviewedAt : null,
    seed_tag: SEED_TAG,
  };

  // history alerts were handled at the time; today's stay open for the demo
  const acknowledged = trip.daysAgo > 0;
  const alerts: TablesInsert<"alerts">[] = verdict.alerts.map((draft) => ({
    org_id: ids.orgId,
    report_id: reportId,
    vehicle_id: vehicleId,
    type: draft.type,
    severity: draft.severity,
    message: draft.message,
    status: acknowledged ? "acknowledged" : "open",
    acknowledged_by: acknowledged ? supervisorId : null,
    acknowledged_at: acknowledged ? (trip.reviewedAt ?? trip.processedAt) : null,
    created_at: trip.processedAt,
    seed_tag: SEED_TAG,
  }));

  const clarifications: TablesInsert<"clarifications">[] =
    status === "needs_clarification"
      ? decision.questions.map((question) => ({ report_id: reportId, org_id: ids.orgId, question, created_at: trip.processedAt, seed_tag: SEED_TAG }))
      : [];

  return { report, alerts, clarifications };
}

// ---------------------------------------------------------------------------
// ownership: everything without the tag is snapshotted and compared afterwards
// ---------------------------------------------------------------------------

type Snapshot = Map<string, string>;

function stable(row: Record<string, unknown>, omit: string[] = []): string {
  const keys = Object.keys(row)
    .filter((key) => !omit.includes(key))
    .sort();
  return JSON.stringify(keys.map((key) => [key, row[key]]));
}

const UNTAGGED = `seed_tag.is.null,seed_tag.neq.${SEED_TAG}`;

async function snapshotUntagged(db: Db, orgId: string, exceptions: { realVehicleId: string | null }): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();
  const tables = ["profiles", "vehicles", "reports", "clarifications", "alerts", "daily_digests", "invites"] as const;
  for (const table of tables) {
    const { data, error } = await db.from(table).select("*").eq("org_id", orgId).or(UNTAGGED);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    for (const row of data ?? []) {
      const omit = table === "vehicles" && row.id === exceptions.realVehicleId ? ["current_odometer"] : [];
      snapshot.set(`${table}:${row.id}`, stable(row as Record<string, unknown>, omit));
    }
  }
  const { data: reportIds } = await db.from("reports").select("id").eq("org_id", orgId).or(UNTAGGED);
  const ids = (reportIds ?? []).map((row) => row.id);
  if (ids.length > 0) {
    const { data: edits, error } = await db.from("report_edits").select("*").in("report_id", ids).or(UNTAGGED);
    if (error) throw new Error(`Could not read report_edits: ${error.message}`);
    for (const row of edits ?? []) snapshot.set(`report_edits:${row.id}`, stable(row as Record<string, unknown>));
  }
  const { data: org, error: orgError } = await db.from("organizations").select("*").eq("id", orgId).single();
  if (orgError) throw new Error(`Could not read the organisation: ${orgError.message}`);
  snapshot.set(`organizations:${org.id}`, stable(org as Record<string, unknown>, ["fuel_baseline_km_per_l"]));
  return snapshot;
}

function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const [key, value] of before) {
    const now = after.get(key);
    if (now === undefined) problems.push(`${key} was deleted`);
    else if (now !== value) problems.push(`${key} was modified`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// accounts and vehicles (upserted: sessions and ids survive a re-run)
// ---------------------------------------------------------------------------

function emailFor(base: string, key: PersonKey): string {
  const [local, domain] = base.split("@");
  if (!local || !domain) throw new Error(`SEED_EMAIL_BASE must be an email address, got "${base}".`);
  return `${local}+${key}@${domain}`;
}

async function findUsers(db: Db): Promise<User[]> {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Could not list auth users: ${error.message}`);
  return data.users;
}

async function ensureAccounts(db: Db, orgId: string, emailBase: string): Promise<{ ids: Map<PersonKey, string>; emails: Map<PersonKey, string>; created: number; problems: string[] }> {
  const users = await findUsers(db);
  const ids = new Map<PersonKey, string>();
  const emails = new Map<PersonKey, string>();
  const problems: string[] = [];
  let created = 0;

  for (const person of PEOPLE) {
    const email = emailFor(emailBase, person.key);
    emails.set(person.key, email);
    let user = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) ?? null;
    if (!user) {
      const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: person.name } });
      if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
      user = data.user;
      created += 1;
    }
    const { data: existing } = await db.from("profiles").select("id, org_id, seed_tag").eq("id", user.id).maybeSingle();
    if (existing && (existing.seed_tag !== SEED_TAG || existing.org_id !== orgId)) {
      problems.push(`${email} already has a profile that the seed does not own (org ${existing.org_id}, tag ${existing.seed_tag ?? "none"}).`);
      continue;
    }
    const { error } = await db.from("profiles").upsert(
      { id: user.id, org_id: orgId, full_name: person.name, phone: person.phone, role: person.role, active: true, seed_tag: SEED_TAG },
      { onConflict: "id" },
    );
    if (error) throw new Error(`Could not write the profile for ${email}: ${error.message}`);
    ids.set(person.key, user.id);
  }
  return { ids, emails, created, problems };
}

async function ensureVehicles(db: Db, orgId: string, profileIds: Map<PersonKey, string>): Promise<{ ids: Map<string, string>; problems: string[] }> {
  const { data: existing, error } = await db.from("vehicles").select("id, plate_number, seed_tag").eq("org_id", orgId);
  if (error) throw new Error(`Could not read vehicles: ${error.message}`);
  const problems: string[] = [];
  const ids = new Map<string, string>();

  for (const spec of VEHICLES) {
    const found = (existing ?? []).find((row) => row.plate_number.toUpperCase() === spec.plate.toUpperCase());
    if (found && found.seed_tag !== SEED_TAG) {
      problems.push(`Vehicle ${spec.plate} exists without the seed tag; rename or remove it, or change the seed's plates.`);
      continue;
    }
    const { data, error: upsertError } = await db
      .from("vehicles")
      .upsert(
        {
          ...(found ? { id: found.id } : {}),
          org_id: orgId,
          plate_number: spec.plate,
          label: spec.label,
          vehicle_type: spec.type,
          default_driver_id: profileIds.get(spec.driver) ?? null,
          active: true,
          seed_tag: SEED_TAG,
        },
        { onConflict: "org_id,plate_number" },
      )
      .select("id")
      .single();
    if (upsertError || !data) throw new Error(`Could not write vehicle ${spec.plate}: ${upsertError?.message}`);
    ids.set(spec.plate, data.id);
  }
  return { ids, problems };
}

// ---------------------------------------------------------------------------
// replace the seeded rows
// ---------------------------------------------------------------------------

async function count(db: Db, table: "reports" | "alerts" | "clarifications" | "daily_digests" | "invites" | "vehicles" | "profiles", orgId: string): Promise<number> {
  const { count: n, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("seed_tag", SEED_TAG);
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return n ?? 0;
}

async function deleteSeededRows(db: Db, orgId: string): Promise<{ reports: number; alerts: number; digests: number; strays: number }> {
  const before = { reports: await count(db, "reports", orgId), alerts: await count(db, "alerts", orgId), digests: await count(db, "daily_digests", orgId) };

  // alerts, clarifications and edits that the app added to seeded reports (a re-check after an
  // edit replaces alerts without the tag) go with their report
  const { data: seededReports } = await db.from("reports").select("id").eq("org_id", orgId).eq("seed_tag", SEED_TAG);
  const seededIds = (seededReports ?? []).map((row) => row.id);
  let strays = 0;
  if (seededIds.length > 0) {
    for (const table of ["alerts", "clarifications", "report_edits"] as const) {
      const { count: n } = await db.from(table).select("id", { count: "exact", head: true }).in("report_id", seededIds).or(UNTAGGED);
      strays += n ?? 0;
    }
  }

  const steps: Array<["reports" | "alerts" | "clarifications" | "daily_digests" | "invites", string]> = [
    ["reports", "reports"],
    ["alerts", "alerts"],
    ["clarifications", "clarifications"],
    ["daily_digests", "digests"],
    ["invites", "invites"],
  ];
  for (const [table] of steps) {
    const { error } = await db.from(table).delete().eq("org_id", orgId).eq("seed_tag", SEED_TAG);
    if (error) throw new Error(`Could not delete seeded ${table}: ${error.message}`);
  }
  return { ...before, strays };
}

async function insertInChunks<T extends "reports" | "alerts" | "clarifications">(db: Db, table: T, rows: TablesInsert<T>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 100) as never);
    if (error) throw new Error(`Could not insert ${table}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// --wipe
// ---------------------------------------------------------------------------

async function wipe(db: Db, orgId: string): Promise<number> {
  const removed = await deleteSeededRows(db, orgId);
  const { data: vehicles } = await db.from("vehicles").select("id, plate_number").eq("org_id", orgId).eq("seed_tag", SEED_TAG);
  const { data: profiles } = await db.from("profiles").select("id, full_name").eq("org_id", orgId).eq("seed_tag", SEED_TAG);
  const vehicleIds = (vehicles ?? []).map((row) => row.id);
  const profileIds = (profiles ?? []).map((row) => row.id);

  const blockers: string[] = [];
  if (vehicleIds.length > 0) {
    const { count: n } = await db.from("reports").select("id", { count: "exact", head: true }).in("vehicle_id", vehicleIds);
    if (n) blockers.push(`${n} real report(s) are on seeded vehicles`);
  }
  if (profileIds.length > 0) {
    const checks: Array<[string, PromiseLike<{ count: number | null }>]> = [
      ["reports sent by", db.from("reports").select("id", { count: "exact", head: true }).in("user_id", profileIds)],
      ["reports approved by", db.from("reports").select("id", { count: "exact", head: true }).in("reviewed_by", profileIds)],
      ["alerts acknowledged by", db.from("alerts").select("id", { count: "exact", head: true }).in("acknowledged_by", profileIds)],
      ["edits made by", db.from("report_edits").select("id", { count: "exact", head: true }).in("edited_by", profileIds)],
      ["invites used by", db.from("invites").select("id", { count: "exact", head: true }).in("used_by", profileIds)],
    ];
    for (const [label, query] of checks) {
      const { count: n } = await query;
      if (n) blockers.push(`${n} row(s) of real data are ${label} seeded accounts`);
    }
  }
  if (blockers.length > 0) {
    console.error(`\nSeeded rows removed (${removed.reports} reports, ${removed.alerts} alerts, ${removed.digests} digests), but the seeded vehicles and accounts stay: ${blockers.join("; ")}.`);
    console.error("Remove or reassign those rows first, then run --wipe again.");
    return 1;
  }

  if (vehicleIds.length > 0) {
    const { error } = await db.from("vehicles").delete().in("id", vehicleIds);
    if (error) throw new Error(`Could not delete seeded vehicles: ${error.message}`);
  }
  for (const id of profileIds) {
    const { error } = await db.from("profiles").delete().eq("id", id);
    if (error) throw new Error(`Could not delete a seeded profile: ${error.message}`);
    const { error: authError } = await db.auth.admin.deleteUser(id);
    if (authError) console.warn(`Profile removed but the auth user ${id} could not be deleted: ${authError.message}`);
  }
  console.log(`Removed ${removed.reports} reports, ${removed.alerts} alerts, ${removed.digests} digests, ${vehicleIds.length} vehicles and ${profileIds.length} accounts.`);
  return 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function resolveOrg(db: Db) {
  const wanted = process.env.SEED_ORG_ID?.trim();
  const select = "id, name, timezone, report_cutoff_time, fuel_baseline_km_per_l";
  if (wanted) {
    const { data, error } = await db.from("organizations").select(select).eq("id", wanted).maybeSingle();
    if (error) throw new Error(`Could not read organisation ${wanted}: ${error.message}`);
    if (!data) throw new Error(`SEED_ORG_ID=${wanted} does not match an organisation.`);
    return { org: data, how: "SEED_ORG_ID" };
  }
  const { data: byName, error } = await db.from("organizations").select(select).eq("name", DEFAULT_ORG_NAME);
  if (error) throw new Error(`Could not look up "${DEFAULT_ORG_NAME}": ${error.message}`);
  if (byName && byName.length === 1) return { org: byName[0], how: `the one organisation named "${DEFAULT_ORG_NAME}"` };
  if (byName && byName.length > 1) {
    throw new Error(`${byName.length} organisations are named "${DEFAULT_ORG_NAME}". Set SEED_ORG_ID to one of: ${byName.map((org) => org.id).join(", ")}`);
  }
  const { data: all } = await db.from("organizations").select(select);
  if (all && all.length === 1) return { org: all[0], how: `the only organisation in the project ("${all[0].name}")` };
  throw new Error(
    all && all.length > 0
      ? `No organisation named "${DEFAULT_ORG_NAME}" and ${all.length} organisations exist. Set SEED_ORG_ID to one of: ${all.map((org) => `${org.id} (${org.name})`).join(", ")}`
      : "No organisation exists yet. Sign in, name your business on /onboarding, then run the seed again.",
  );
}

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
    return 1;
  }
  const db: Db = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  const { org, how } = await resolveOrg(db);
  console.log(`Organisation: ${org.name} (${org.id}), from ${how}. ${org.timezone}, cutoff ${formatTime12h(org.report_cutoff_time)}.`);

  if (process.argv.includes("--wipe")) return wipe(db, org.id);

  const emailBase = process.env.SEED_EMAIL_BASE?.trim();
  if (!emailBase) {
    console.error("SEED_EMAIL_BASE is not set. Use an inbox you can read, e.g. me@gmail.com (the accounts become me+musa@gmail.com …).");
    return 1;
  }
  const realPlate = (process.env.SEED_REAL_PLATE?.trim() || "T-25783-LA").toUpperCase();
  const realOdometerRaw = process.env.SEED_REAL_ODOMETER?.trim();
  const realOdometer = realOdometerRaw ? Number(realOdometerRaw.replace(/[\s,]/g, "")) : null;
  if (realOdometerRaw && !(Number.isFinite(realOdometer) && (realOdometer as number) >= 0)) {
    console.error(`SEED_REAL_ODOMETER must be a number, got "${realOdometerRaw}".`);
    return 1;
  }

  const { data: realVehicle } = await db.from("vehicles").select("id, plate_number, current_odometer, seed_tag").eq("org_id", org.id).ilike("plate_number", realPlate).maybeSingle();
  if (realVehicle?.seed_tag === SEED_TAG) {
    console.error(`${realPlate} is a seeded vehicle; SEED_REAL_PLATE must name a hand-made one.`);
    return 1;
  }
  const before = await snapshotUntagged(db, org.id, { realVehicleId: realVehicle && realOdometer !== null ? realVehicle.id : null });

  // 1. accounts and vehicles
  const accounts = await ensureAccounts(db, org.id, emailBase);
  const vehicles = accounts.problems.length === 0 ? await ensureVehicles(db, org.id, accounts.ids) : { ids: new Map<string, string>(), problems: [] };
  const problems = [...accounts.problems, ...vehicles.problems];
  if (problems.length > 0) {
    console.error(`\nRefusing to seed:\n  - ${problems.join("\n  - ")}`);
    return 1;
  }
  const ids: Ids = { orgId: org.id, vehicleIds: vehicles.ids, profileIds: accounts.ids };

  // 2. previous run out, this run in
  const removed = await deleteSeededRows(db, org.id);

  const clock: Clock = { timezone: org.timezone, today: localClock(org.timezone, new Date()).date, nowMs: Date.now() };
  const trips = generateTrips(clock);
  const baseline = fuelBaseline(trips);
  const built = trips.map((trip) => buildRows(trip, baseline, ids));

  await insertInChunks(db, "reports", built.map((row) => row.report));
  await insertInChunks(db, "alerts", built.flatMap((row) => row.alerts));
  await insertInChunks(db, "clarifications", built.flatMap((row) => row.clarifications));

  // 3. missing-report alerts the digest cron would have raised for seeded gaps on the digest days
  const supervisorId = ids.profileIds.get("supervisor") as string;
  const digestDates = Array.from({ length: DIGEST_DAYS }, (_, i) => shiftDate(clock.today, -(i + 1)));
  const missingAlerts: TablesInsert<"alerts">[] = [];
  for (const date of digestDates) {
    const daysAgo = Math.round((Date.parse(clock.today) - Date.parse(date)) / 86_400_000);
    const raisedAt = atLocal(clock, date, cutoffMinutes(org.report_cutoff_time) + 35);
    for (const spec of VEHICLES) {
      if (!spec.gaps.includes(daysAgo)) continue;
      missingAlerts.push({
        org_id: org.id,
        report_id: null,
        vehicle_id: ids.vehicleIds.get(spec.plate) as string,
        ...missingReportAlert(spec.plate, formatDayShort(date)),
        status: "acknowledged",
        acknowledged_by: supervisorId,
        acknowledged_at: atLocal(clock, shiftDate(date, 1), 8 * 60 + 15),
        created_at: raisedAt,
        seed_tag: SEED_TAG,
      });
    }
  }
  await insertInChunks(db, "alerts", missingAlerts);

  // 4. odometers and the baseline
  const odometers = new Map<string, number>();
  for (const trip of trips) if (trip.outcome === "reviewed") odometers.set(trip.spec.plate, trip.end);
  for (const spec of VEHICLES) {
    const { error } = await db
      .from("vehicles")
      .update({ current_odometer: odometers.get(spec.plate) ?? spec.opening })
      .eq("id", ids.vehicleIds.get(spec.plate) as string);
    if (error) throw new Error(`Could not set the odometer of ${spec.plate}: ${error.message}`);
  }
  let realVehicleLine = `${realPlate} not found in this organisation; nothing to set.`;
  if (realVehicle && realOdometer !== null) {
    const { error } = await db.from("vehicles").update({ current_odometer: realOdometer }).eq("id", realVehicle.id);
    if (error) throw new Error(`Could not set the odometer of ${realPlate}: ${error.message}`);
    realVehicleLine = `${realVehicle.plate_number} odometer ${realVehicle.current_odometer === null ? "unset" : formatGrouped(realVehicle.current_odometer)} → ${formatGrouped(realOdometer)} (SEED_REAL_ODOMETER); no history generated for it.`;
  } else if (realVehicle) {
    realVehicleLine = `${realVehicle.plate_number} left at odometer ${realVehicle.current_odometer === null ? "unset" : formatGrouped(realVehicle.current_odometer)} (set SEED_REAL_ODOMETER to change it); no history generated for it.`;
  }
  const { error: baselineError } = await db.from("organizations").update({ fuel_baseline_km_per_l: baseline }).eq("id", org.id);
  if (baselineError) throw new Error(`Could not store the fuel baseline: ${baselineError.message}`);

  // 5. past digests, computed from the rows (the same aggregation the cron uses; plain markdown, no model call)
  const digestOrg: DigestOrg = { id: org.id, name: org.name, timezone: org.timezone, report_cutoff_time: org.report_cutoff_time };
  const digestLines: string[] = [];
  for (const date of digestDates) {
    const { data: existing } = await db.from("daily_digests").select("id, seed_tag").eq("org_id", org.id).eq("digest_date", date).maybeSingle();
    if (existing && existing.seed_tag !== SEED_TAG) {
      digestLines.push(`${formatDayShort(date)}: kept the existing digest (not seeded)`);
      continue;
    }
    const data = await collectDigestData(db, digestOrg, date);
    const { error } = await db.from("daily_digests").insert({
      org_id: org.id,
      digest_date: date,
      content_md: renderDigestFallback(data),
      stats: toJson(data.stats),
      generated_at: atLocal(clock, date, cutoffMinutes(org.report_cutoff_time) + 36),
      seed_tag: SEED_TAG,
    });
    if (error) throw new Error(`Could not write the digest for ${date}: ${error.message}`);
    digestLines.push(`${formatDayShort(date)}: reported ${data.stats.reported}/${data.vehicles_total}, ${data.stats.alerts} alert(s), ${formatGrouped(data.stats.total_km)} km, ${formatGrouped(data.stats.total_fuel_l)} L`);
  }

  // 6. verify ownership and idempotence
  const after = await snapshotUntagged(db, org.id, { realVehicleId: realVehicle && realOdometer !== null ? realVehicle.id : null });
  const violations = diffSnapshots(before, after);
  const tagged = {
    profiles: await count(db, "profiles", org.id),
    vehicles: await count(db, "vehicles", org.id),
    reports: await count(db, "reports", org.id),
    alerts: await count(db, "alerts", org.id),
    clarifications: await count(db, "clarifications", org.id),
    digests: await count(db, "daily_digests", org.id),
  };
  const expected = {
    profiles: PEOPLE.length,
    vehicles: VEHICLES.length,
    reports: built.length,
    alerts: built.reduce((sum, row) => sum + row.alerts.length, 0) + missingAlerts.length,
    clarifications: built.reduce((sum, row) => sum + row.clarifications.length, 0),
    digests: digestLines.filter((line) => !line.includes("kept")).length,
  };
  const countProblems = (Object.keys(expected) as Array<keyof typeof expected>).filter((key) => tagged[key] !== expected[key]).map((key) => `${key}: ${tagged[key]} tagged rows, expected ${expected[key]}`);

  // 7. the summary
  const openAlerts = built.reduce((sum, row) => sum + row.alerts.filter((alert) => alert.status === "open").length, 0);
  const ackAlerts = expected.alerts - openAlerts;
  const perDay = new Map<string, string[]>();
  for (const trip of trips) {
    const mark = trip.outcome === "reviewed" ? "approved" : trip.outcome === "ready" ? (trip.spec.plate === "KNO 774 AA" && trip.daysAgo === 0 ? "ready + alert" : "ready") : "needs answer";
    perDay.set(trip.date, [...(perDay.get(trip.date) ?? []), `${trip.spec.plate} ${mark}`]);
  }

  console.log("");
  console.log(`Seeded ${org.name}${removed.reports > 0 ? ` (replaced ${removed.reports} reports, ${removed.alerts} alerts and ${removed.digests} digests from the previous run${removed.strays > 0 ? `, plus ${removed.strays} rows the app had attached to them` : ""})` : ""}.`);
  const rows: Array<[string, string]> = [
    ["Vehicles", `${VEHICLES.length} seeded (${VEHICLES.map((spec) => `${spec.plate} at ${formatGrouped(odometers.get(spec.plate) ?? spec.opening)}`).join(", ")}); ${realVehicleLine}`],
    ["Fuel baseline", baseline === null ? "not set (no history with fuel)" : `${baseline} km/L, the median of ${trips.filter((trip) => trip.daysAgo > 0 && trip.fuel).length} approved trips with fuel`],
    ["Reports", `${built.length} (${trips.filter((trip) => trip.daysAgo > 0).length} approved over ${HISTORY_DAYS} days, ${trips.filter((trip) => trip.daysAgo === 0).length} today)`],
    ["Alerts", `${openAlerts} open (today's fuel outlier), ${ackAlerts} acknowledged (${missingAlerts.length} missing reports, the rest incidents incl. the breakdown ${BREAKDOWN.daysAgo} days ago on ${BREAKDOWN.plate})`],
    ["Digests", digestLines.join("; ")],
    ["Accounts", PEOPLE.map((person) => `${accounts.emails.get(person.key)} (${person.name}, ${person.role === "field" ? "driver" : person.role})`).join(", ")],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.log(`  ${label.padEnd(width)}  ${value}`);
  console.log("  Reports per day");
  for (const [date, marks] of Array.from(perDay.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`    ${formatDayShort(date).padEnd(11)} ${marks.length} — ${marks.join(", ")}`);
  }
  console.log(`  Today's board: ${VEHICLES.map((spec) => `${spec.plate} ${TODAY[spec.plate].replace("_", " ")}`).join(", ")}${realVehicle ? `, ${realVehicle.plate_number} live` : ""}.`);
  console.log(`  Sign in locally with a printed code: npm run dev:magic-link -- ${accounts.emails.get("supervisor")} /dashboard   (${accounts.created} new auth user(s) this run; the rest already existed)`);
  if (org.report_cutoff_time.slice(0, 5) !== DEMO_CUTOFF) {
    console.log(`  Note: the organisation's cutoff is ${formatTime12h(org.report_cutoff_time)}; the demo runbook assumes ${formatTime12h(DEMO_CUTOFF)}. Change it on /dashboard/settings if that is not intended.`);
  }

  const untouched = Array.from(before.keys()).reduce<Record<string, number>>((acc, key) => {
    const table = key.split(":")[0];
    acc[table] = (acc[table] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  Ownership: ${Object.entries(untouched).map(([table, n]) => `${n} ${table}`).join(", ")} without the tag were checked before and after.`);

  if (violations.length > 0 || countProblems.length > 0) {
    console.error(`\nFAILED ownership or idempotence checks:\n  - ${[...violations, ...countProblems].join("\n  - ")}`);
    return 1;
  }
  console.log("  All ownership and idempotence checks passed.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
