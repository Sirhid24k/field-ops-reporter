import type { Metadata } from "next";
import Link from "next/link";
import { BottomZone, BackHeader, Screen } from "@/components/field/Frame";
import { buttonClassName } from "@/components/ui";

export const metadata: Metadata = { title: "Not found" };

/** A report link that is not this driver's, or no longer exists. */
export default function FieldNotFound() {
  return (
    <Screen>
      <BackHeader title="Not found" />
      <p className="mt-3 text-body-lg">This report isn&rsquo;t here. It may be someone else&rsquo;s, or the link is old.</p>
      <BottomZone>
        <Link href="/app" className={buttonClassName({ size: "field", block: true })}>
          Back to Today
        </Link>
      </BottomZone>
    </Screen>
  );
}
