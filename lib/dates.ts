/**
 * Dates in the organisation's timezone, written the way the copy rules want them:
 * "Tuesday 2 Sep", "Tue 2 Sep", "September", "6:42 pm".
 *
 * Assembled by hand rather than with a locale string because ICU's en-GB short
 * month is "Sept" and en-US puts the day after the month.
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The calendar date (YYYY-MM-DD) of `date` in `timeZone`. */
export function dateInZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export type CalendarDate = { year: number; month: number; day: number; weekday: number };

export function parseIsoDate(iso: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday };
}

/** "Tuesday 2 Sep" — the screen title on Today. */
export function formatDayLong(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return `${WEEKDAYS_LONG[date.weekday]} ${date.day} ${MONTHS_SHORT[date.month - 1]}`;
}

/** "Tue 2 Sep" — list rows and summary lines. */
export function formatDayShort(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return `${WEEKDAYS_SHORT[date.weekday]} ${date.day} ${MONTHS_SHORT[date.month - 1]}`;
}

/** "2026-09" — grouping key for the month headings on My reports. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** "September", or "September 2025" once the year differs from today's. */
export function formatMonthHeading(iso: string, todayIso: string): string {
  const date = parseIsoDate(iso);
  const today = parseIsoDate(todayIso);
  if (!date) return iso;
  const month = MONTHS_LONG[date.month - 1];
  return today && today.year === date.year ? month : `${month} ${date.year}`;
}

/** "6:42 pm" in the organisation's timezone. */
export function formatClock(timestamp: string | Date, timeZone: string): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`.trim();
  } catch {
    return "";
  }
}

/** True for a YYYY-MM-DD string that is a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** YYYY-MM-DD plus `days` (negative to go back). */
export function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** "6:48 pm" on the day itself, otherwise "Tue 2 Sep, 6:48 pm" (a comma, never a middle dot). */
export function formatDateTime(timestamp: string | Date, timeZone: string, todayIso: string): string {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) return "";
  const day = dateInZone(date, timeZone);
  const clock = formatClock(date, timeZone);
  return day === todayIso ? clock : `${formatDayShort(day)}, ${clock}`;
}
