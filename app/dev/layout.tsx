import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { devToolsEnabled } from "@/lib/dev-tools";

// evaluated per request, so DEV_TOOLS=true works on a deployment without a rebuild
export const dynamic = "force-dynamic";

/**
 * Every screen under /dev (the primitive gallery, the report status flipper) is a
 * developer tool: on outside production, and on a deployment only with DEV_TOOLS=true.
 * Anything else answers 404, the same as a route that does not exist.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (!devToolsEnabled()) notFound();
  return children;
}
