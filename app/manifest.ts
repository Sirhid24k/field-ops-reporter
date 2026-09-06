import type { MetadataRoute } from "next";

/** Served at /manifest.webmanifest and linked from every page by Next.js. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Field Ops Reporter",
    short_name: "Field Ops",
    description: "Voice-first daily reporting for haulage and site teams.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F8F8F4",
    theme_color: "#161C1B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
