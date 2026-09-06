/**
 * Connectivity probe for the field app. `navigator.onLine` only knows about the
 * network interface; a 200 from here means the server is actually reachable.
 * The service worker never caches /api/*, so this always hits the network.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, at: Date.now() }, { headers: { "cache-control": "no-store" } });
}

export async function HEAD() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
