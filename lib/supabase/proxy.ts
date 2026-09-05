import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "./types";

/**
 * Supabase client for proxy.ts. Refreshes an expired session and writes the new
 * cookies to the outgoing response. `redirect()` carries those cookies along.
 */
export function createProxyClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  return {
    supabase,
    /** The pass-through response, including any refreshed session cookies. */
    response: () => response,
    /** A redirect that keeps refreshed session cookies. */
    redirect: (path: string) => {
      const target = NextResponse.redirect(new URL(path, request.url));
      response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
      return target;
    },
  };
}
