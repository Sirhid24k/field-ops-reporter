"use client";

import { useState } from "react";
import { Button, Drawer, Input, ProgressLine, Select, Sheet, Switch } from "@/components/ui";

/** The Switch in both states, live, plus the inert ones the tables use. */
export function SwitchDemo() {
  const [vehicle, setVehicle] = useState(true);
  const [person, setPerson] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <Switch checked={vehicle} onChange={setVehicle} label="KTU 421 XA" />
      <Switch checked={person} onChange={setPerson} label="Musa Abdullahi" />
      <Switch checked disabled reason="You can't deactivate yourself." onChange={() => undefined} label="Ngozi Eze" />
      <Switch checked={false} disabled onChange={() => undefined} label="A retired vehicle" />
      <Switch checked pending onChange={() => undefined} label="Saving" />
    </div>
  );
}

export function LoadingButtons() {
  const [loading, setLoading] = useState(false);
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-body">
        <input type="checkbox" checked={loading} onChange={(e) => setLoading(e.target.checked)} />
        Show loading state
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={loading} loadingLabel="Sending…">
          Send report
        </Button>
        <Button variant="secondary" loading={loading} loadingLabel="Saving…">
          Save
        </Button>
        <Button variant="destructive" loading={loading} loadingLabel="Rejecting…">
          Reject
        </Button>
        <Button variant="text" loading={loading} loadingLabel="Acknowledging…">
          Acknowledge
        </Button>
        <Button size="field" loading={loading} loadingLabel="Sending…">
          Send report
        </Button>
      </div>
    </div>
  );
}

export function ProgressLineDemo() {
  const [active, setActive] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <ProgressLine active={active} />
      <Button
        variant="secondary"
        onClick={() => {
          setActive(true);
          setTimeout(() => setActive(false), 3000);
        }}
      >
        Show progress line for 3 seconds
      </Button>
      <span className="text-body text-steel">{active ? "Running at the top of the viewport" : "Idle"}</span>
    </div>
  );
}

export function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open sheet
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <p className="text-body-lg">Saved on your phone. It&rsquo;ll send when you&rsquo;re online.</p>
        <Button size="field" block className="mt-6" onClick={() => setOpen(false)}>
          Done
        </Button>
      </Sheet>
    </>
  );
}

export function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open drawer
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Invite someone">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <Select label="Role" defaultValue="field">
            <option value="field">Driver</option>
            <option value="supervisor">Supervisor</option>
          </Select>
          <Input label="Name (optional)" placeholder="Musa Abdullahi" />
          <Button type="submit" block>
            Generate link
          </Button>
        </form>
      </Drawer>
    </>
  );
}
