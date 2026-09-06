import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FieldShell } from "@/components/field/FieldShell";

export const metadata: Metadata = {
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Field Ops" },
};

/** Every driver screen runs inside the shell: connectivity, the offline queue, the service worker. */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return <FieldShell>{children}</FieldShell>;
}
