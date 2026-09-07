import "server-only";

import { headers } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * The origin the current request was made to, for every absolute URL that has to come back
 * to this deployment: sign-in redirects, invite links, the self-call to /api/process.
 *
 * Precedence: `x-forwarded-proto` + `x-forwarded-host` → `host` (scheme from the forwarded
 * proto, else http for localhost and https otherwise) → NEXT_PUBLIC_APP_URL.
 *
 * Trust: on Vercel the forwarded headers are set by the platform and only routed hosts reach
 * the function, so a preview deployment gets its own origin and production gets its own. A
 * self-hosted deployment behind a proxy must give the same guarantee, otherwise a spoofed Host
 * could put a foreign origin into a sign-in email; strip the forwarded headers at the proxy
 * and the fallback applies.
 *
 * Server-only (`headers()`); cron routes and scripts have no request and keep reading
 * NEXT_PUBLIC_APP_URL through `publicEnv.appUrl`.
 */

type HeaderSource = { get(name: string): string | null };

const HOST_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:\d{1,5})?$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function first(value: string | null): string | null {
  const head = value?.split(",")[0]?.trim();
  return head ? head : null;
}

/** The pure part: an origin for a set of request headers, or `fallback` when they are missing or malformed. */
export function originFromHeaders(source: HeaderSource, fallback: string): string {
  const host = first(source.get("x-forwarded-host")) ?? first(source.get("host"));
  if (!host || !HOST_PATTERN.test(host)) return fallback;

  const forwardedProto = first(source.get("x-forwarded-proto"))?.toLowerCase();
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : LOCAL_HOST.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}

/** Origin of the request in scope (Server Components, Server Actions, Route Handlers); NEXT_PUBLIC_APP_URL without one. */
export async function getRequestOrigin(): Promise<string> {
  const fallback = publicEnv.appUrl;
  try {
    return originFromHeaders(await headers(), fallback);
  } catch {
    // no request in scope (a build-time render): the configured URL it is
    return fallback;
  }
}
