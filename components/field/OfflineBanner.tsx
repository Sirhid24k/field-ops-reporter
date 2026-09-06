"use client";

import { useFieldNetwork } from "./FieldShell";

/** Thin ink bar under the header, on any field screen, whenever the server can't be reached. */
export function OfflineBanner() {
  const { online } = useFieldNetwork();
  if (online) return null;
  return (
    <div role="status" className="-mx-4 mt-3 bg-ink px-4 py-1.5 text-caption text-paper">
      You&rsquo;re offline. Reports are saved on this phone.
    </div>
  );
}
