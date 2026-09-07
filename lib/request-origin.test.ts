import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ headers: new Headers() }));

// `server-only` throws outside React Server Components; `next/headers` needs a request in scope
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));

import { getRequestOrigin, originFromHeaders } from "./request-origin";

const FALLBACK = "http://fallback.test";

describe("originFromHeaders", () => {
  it("prefers x-forwarded-proto + x-forwarded-host over host", () => {
    const headers = new Headers({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "field-ops-reporter-git-dev-team.vercel.app",
      host: "internal.lambda:3000",
    });
    expect(originFromHeaders(headers, FALLBACK)).toBe("https://field-ops-reporter-git-dev-team.vercel.app");
  });

  it("falls back to host when there is no forwarded host", () => {
    expect(originFromHeaders(new Headers({ host: "field-ops-reporter.vercel.app" }), FALLBACK)).toBe("https://field-ops-reporter.vercel.app");
    expect(originFromHeaders(new Headers({ host: "app.example.com", "x-forwarded-proto": "http" }), FALLBACK)).toBe("http://app.example.com");
  });

  it("assumes http for localhost and https for anything else when no proto is forwarded", () => {
    expect(originFromHeaders(new Headers({ host: "localhost:3000" }), FALLBACK)).toBe("http://localhost:3000");
    expect(originFromHeaders(new Headers({ host: "127.0.0.1:3000" }), FALLBACK)).toBe("http://127.0.0.1:3000");
    expect(originFromHeaders(new Headers({ host: "192.168.1.20:3000" }), FALLBACK)).toBe("https://192.168.1.20:3000");
  });

  it("takes the first value of a comma-separated forwarded header", () => {
    const headers = new Headers({ "x-forwarded-proto": "https, http", "x-forwarded-host": "preview.example.com, proxy.internal" });
    expect(originFromHeaders(headers, FALLBACK)).toBe("https://preview.example.com");
  });

  it("falls back to NEXT_PUBLIC_APP_URL when there is no host at all", () => {
    expect(originFromHeaders(new Headers(), FALLBACK)).toBe(FALLBACK);
  });

  it("falls back on a malformed host", () => {
    expect(originFromHeaders(new Headers({ host: "evil.example/phish" }), FALLBACK)).toBe(FALLBACK);
    expect(originFromHeaders(new Headers({ "x-forwarded-host": "a b" }), FALLBACK)).toBe(FALLBACK);
    expect(originFromHeaders(new Headers({ host: "https://evil.example" }), FALLBACK)).toBe(FALLBACK);
  });

  it("ignores an unknown forwarded proto", () => {
    expect(originFromHeaders(new Headers({ "x-forwarded-proto": "ftp", host: "app.example.com" }), FALLBACK)).toBe("https://app.example.com");
  });
});

describe("getRequestOrigin", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original;
    state.headers = new Headers();
  });

  it("derives the origin from the request headers, not the env", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    state.headers = new Headers({ "x-forwarded-proto": "https", "x-forwarded-host": "field-ops-reporter-git-dev-team.vercel.app" });
    expect(await getRequestOrigin()).toBe("https://field-ops-reporter-git-dev-team.vercel.app");
  });

  it("uses NEXT_PUBLIC_APP_URL (trailing slash trimmed) when the request has no host", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://field-ops-reporter.vercel.app/";
    state.headers = new Headers();
    expect(await getRequestOrigin()).toBe("https://field-ops-reporter.vercel.app");
  });
});
