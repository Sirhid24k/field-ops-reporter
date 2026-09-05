import { formatTime12h } from "@/lib/format";

/** IANA zones with Africa first; Africa/Lagos is the default everywhere. */
function listTimezones(): string[] {
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Africa/Lagos", "UTC"];
  const unique = Array.from(new Set(["Africa/Lagos", ...all]));
  const africa = unique.filter((zone) => zone.startsWith("Africa/"));
  const rest = unique.filter((zone) => !zone.startsWith("Africa/"));
  return [...africa, ...rest];
}

export const TIMEZONES: readonly string[] = listTimezones();

export const DEFAULT_TIMEZONE = "Africa/Lagos";
export const DEFAULT_CUTOFF = "20:00";

/** Half-hour steps through the day, stored as HH:MM and shown as "8:00 pm". */
export const CUTOFF_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2);
  const minutes = i % 2 === 0 ? "00" : "30";
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  return { value, label: formatTime12h(value) };
});
