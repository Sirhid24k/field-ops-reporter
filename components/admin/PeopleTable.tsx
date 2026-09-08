"use client";

import { useState, useTransition } from "react";
import { createInviteLink, setPersonActive } from "@/app/(admin)/dashboard/people/actions";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { Button, buttonClassName, Drawer } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ActiveToggle } from "./ActiveToggle";
import { PageHeader } from "./PageHeader";
import { VehiclesPeopleTabs } from "./VehiclesPeopleTabs";

export type PersonRow = {
  id: string;
  name: string;
  /** "Driver", "Supervisor", "Admin" */
  role: string;
  phone: string | null;
  /** "Tue 2 Sep", or null for someone who has not reported (or does not report). */
  lastReport: string | null;
  active: boolean;
  isSelf: boolean;
};

type InviteRole = "field" | "supervisor";

const ROLE_OPTIONS: ReadonlyArray<{ value: InviteRole; label: string }> = [
  { value: "field", label: "Driver" },
  { value: "supervisor", label: "Supervisor" },
];

/**
 * A4 People: name, role, phone, last report, active; "Invite someone" opens the drawer with
 * a role choice, then the link in full (selectable), Copy link and Share on WhatsApp.
 */
export function PeopleTable({ rows, openInvite = false }: { rows: PersonRow[]; openInvite?: boolean }) {
  const [inviteOpen, setInviteOpen] = useState(openInvite);

  const head = "px-3 py-2 text-left text-caption font-normal text-steel first:pl-2 last:pr-2";
  const cell = "px-3 py-2 first:pl-2 last:pr-2";

  return (
    <>
      <PageHeader
        title="Vehicles and people"
        beside={<VehiclesPeopleTabs active="people" />}
        actions={<Button onClick={() => setInviteOpen(true)}>Invite someone</Button>}
      />

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={head}>Name</th>
              <th className={head}>Role</th>
              <th className={head}>Phone</th>
              <th className={head}>Last report</th>
              <th className={head}>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="h-12 border-b border-line">
                <td className={cn(cell, "text-body-lg")}>
                  {row.name}
                  {row.isSelf ? <span className="ml-2 text-caption text-steel">you</span> : null}
                </td>
                <td className={cell}>{row.role}</td>
                <td className={cn(cell, "tabular")}>{row.phone ?? <span className="text-steel">—</span>}</td>
                <td className={cn(cell, "font-display text-body-lg font-semibold tabular")}>
                  {row.lastReport ?? <span className="font-body text-body font-normal text-steel">—</span>}
                </td>
                <td className={cell}>
                  <ActiveToggle
                    active={row.active}
                    label={row.name}
                    disabled={row.isSelf}
                    reason="You can't deactivate yourself."
                    onToggle={(active) => setPersonActive({ profileId: row.id, active })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite someone">
        {inviteOpen ? <InviteForm /> : null}
      </Drawer>
    </>
  );
}

function InviteForm() {
  const [role, setRole] = useState<InviteRole>("field");
  const [link, setLink] = useState<{ url: string; whatsappUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await createInviteLink({ role });
      if (result.ok) setLink({ url: result.url, whatsappUrl: result.whatsappUrl });
      else setError(result.message);
    });
  }

  return (
    <div>
      <p className="text-caption text-steel" id="invite-role-label">
        Role
      </p>
      <div role="group" aria-labelledby="invite-role-label" className="mt-1.5 flex gap-2">
        {ROLE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={role === option.value}
            onClick={() => {
              setRole(option.value);
              setLink(null);
            }}
            className={cn(
              "min-h-12 flex-1 rounded-control border px-4 font-display text-body-lg font-semibold",
              role === option.value ? "border-ink bg-ink/6 text-ink" : "border-line text-steel hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-caption text-steel">
        {role === "field" ? "A driver signs in on their phone and sees only their own reports." : "A supervisor sees this dashboard for the whole organisation."}
      </p>

      {link ? (
        <>
          <p className="mt-7 text-caption text-steel">Invite link</p>
          <p className="mt-1.5 select-all rounded-control border border-line bg-ink/6 px-3 py-3 text-body break-all">{link.url}</p>
          <p className="mt-1.5 text-caption text-steel">Works once, for 7 days.</p>
          <div className="mt-4 flex flex-col gap-3">
            <CopyLinkButton link={link.url} />
            <a href={link.whatsappUrl} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "secondary", block: true })}>
              Share on WhatsApp
            </a>
          </div>
        </>
      ) : (
        <Button onClick={generate} loading={pending} loadingLabel="Generating…" block className="mt-7">
          Generate link
        </Button>
      )}
      {error ? (
        <p role="alert" className="mt-3 border-l-4 border-flag pl-3 text-body text-flag">
          {error}
        </p>
      ) : null}
    </div>
  );
}
