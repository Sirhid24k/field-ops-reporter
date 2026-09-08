import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireStaff } from "@/lib/auth";
import { SettingsForm } from "./SettingsForm";

export const metadata: Metadata = { title: "Settings" };

/** Settings stub (session-4 prompt §1): the organisation's name, timezone and cutoff, editable. */
export default async function SettingsPage() {
  const { organization } = await requireStaff();

  return (
    <>
      <PageHeader title="Settings" />
      <p className="mt-3 max-w-[60ch] text-body-lg text-steel">
        The report cutoff is when drivers are asked to have reported by, and when the day&rsquo;s digest is written.
      </p>
      <SettingsForm
        name={organization.name}
        timezone={organization.timezone}
        cutoff={organization.report_cutoff_time.slice(0, 5)}
      />
    </>
  );
}
