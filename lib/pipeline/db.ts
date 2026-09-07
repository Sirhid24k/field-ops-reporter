import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * The pipeline runs with the service role but never constructs that client itself:
 * route handlers and server actions pass `createAdminClient()` (server-only), and
 * `scripts/pipeline-test.mts` builds its own, so the same code runs inline from the
 * command line. Nothing under lib/pipeline is imported by client code.
 */
export type PipelineDb = SupabaseClient<Database>;

/** Round-trips a value through JSON so it fits the `Json` column type (drops `undefined`). */
export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

/** Whole days between two YYYY-MM-DD dates (b - a), or null when either is missing. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (![ay, am, ad, by, bm, bd].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
