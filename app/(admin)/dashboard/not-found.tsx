import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/admin/PageHeader";
import { buttonClassName } from "@/components/ui";

export const metadata: Metadata = { title: "Not found" };

/** A report or page that is not in this organisation, or no longer exists. */
export default function DashboardNotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <p className="mt-3 max-w-[60ch] text-body-lg">This page isn&rsquo;t here. The report may belong to another organisation, or the link is old.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/dashboard" className={buttonClassName()}>
          Today
        </Link>
        <Link href="/dashboard/reports" className={buttonClassName({ variant: "secondary" })}>
          All reports
        </Link>
      </div>
    </>
  );
}
