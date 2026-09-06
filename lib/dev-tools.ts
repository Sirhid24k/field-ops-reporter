/**
 * Gate for the developer-only screens under /dev (report status flipper).
 * On by default outside production; set DEV_TOOLS=true to keep them on a deployment.
 */
export function devToolsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DEV_TOOLS === "true";
}
