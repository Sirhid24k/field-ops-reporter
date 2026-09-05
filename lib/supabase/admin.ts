import "server-only";

import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Service-role client. Bypasses RLS, so use it only for the few writes that
 * cannot run as the user: creating an organization + admin profile during
 * onboarding, completing an invite, and (session 3) the processing pipeline.
 *
 * The `server-only` import above makes any client-side import a build error.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("Missing environment variable SUPABASE_SERVICE_ROLE_KEY (server-only).");
  }

  return createClient<Database>(publicEnv.supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
