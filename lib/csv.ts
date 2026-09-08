/**
 * CSV the way Excel opens it: a UTF-8 byte-order mark, CRLF line ends, RFC 4180 quoting.
 * Text that a spreadsheet would run as a formula gets a leading apostrophe.
 */

export const CSV_BOM = "﻿";

export type CsvValue = string | number | null | undefined;

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+@\t\r]/;
const LOOKS_NUMERIC = /^-?\d+(\.\d+)?$/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (FORMULA_START.test(text) || (text.startsWith("-") && !LOOKS_NUMERIC.test(text))) text = `'${text}`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: CsvValue[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}
