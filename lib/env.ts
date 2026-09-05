/**
 * Environment access. Public values are inlined into the client bundle by Next.js
 * because they are read as literal `process.env.NEXT_PUBLIC_*` members.
 * Server-only secrets are read where they are used (see lib/supabase/admin.ts).
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

export const publicEnv = {
  get supabaseUrl(): string {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  /** Origin without a trailing slash, e.g. http://localhost:3000 */
  get appUrl(): string {
    return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
};
