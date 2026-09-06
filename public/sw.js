/*
  Field Ops Reporter service worker.

  Keeps the field app shell available offline and nothing more. The offline report
  queue lives in app code (lib/queue.ts), not here: this worker never sees a report.

  - install:  cache the field pages and the static assets their HTML references
  - fetch:    pages are network-first with the cached copy as fallback (any /app URL
              falls back to /app); hashed static assets are cache-first
  - /api/*, /auth/*, /dev/* and router (RSC) requests are never touched
*/

const VERSION = "fo-shell-v1";
const SHELL_PAGES = ["/app", "/app/new", "/app/reports"];
const SHELL_ASSETS = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      const assets = new Set(SHELL_ASSETS);

      for (const path of SHELL_PAGES) {
        try {
          const response = await fetch(path, { credentials: "same-origin", headers: { accept: "text/html" } });
          // signed out (redirect) or an error: leave the page out rather than cache the wrong thing
          if (!response.ok || response.redirected) continue;
          const html = await response.clone().text();
          await cache.put(path, response);
          for (const url of staticAssetsIn(html)) assets.add(url);
        } catch {
          // offline during install: the next activation tries again
        }
      }

      await Promise.all(
        [...assets].map(async (url) => {
          try {
            const response = await fetch(url, { credentials: "same-origin" });
            if (response.ok) await cache.put(url, response);
          } catch {
            // best effort
          }
        }),
      );

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/dev/")) return;
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(pageNetworkFirst(request, url));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(assetCacheFirst(request));
  }
});

/** Every /_next/static/... URL a page's HTML refers to (script tags, preloads, flight data). */
function staticAssetsIn(html) {
  const urls = new Set();
  for (const match of html.matchAll(/["'(](\/_next\/static\/[^"')\s\\]+)/g)) urls.add(match[1].replace(/&amp;/g, "&"));
  for (const match of html.matchAll(/["'](static\/(?:chunks|css|media)\/[^"'\s\\]+)/g)) {
    urls.add(`/_next/${match[1].replace(/&amp;/g, "&")}`);
  }
  return urls;
}

function isFieldPage(pathname) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

async function pageNetworkFirst(request, url) {
  const cache = await caches.open(VERSION);
  const key = url.pathname; // the query string is dropped so /app?anything finds /app
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected && isFieldPage(key)) await cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) || (await cache.match("/app")) || Response.error();
  }
}

async function assetCacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
