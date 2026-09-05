import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Button, CHIP_STATUSES, Input, OdometerDigits, Select, StatusChip, Textarea } from "@/components/ui";
import { DrawerDemo, LoadingButtons, ProgressLineDemo, SheetDemo } from "./Interactive";

export const metadata: Metadata = {
  title: "UI gallery",
  robots: { index: false, follow: false },
};

const COLORS = [
  { token: "paper", hex: "#F8F8F4", use: "Page background", className: "bg-paper" },
  { token: "ink", hex: "#161C1B", use: "Text, primary buttons, record disc", className: "bg-ink" },
  { token: "steel", hex: "#6E7573", use: "Secondary text, timestamps, disabled", className: "bg-steel" },
  { token: "line", hex: "#D6D9D4", use: "Borders and dividers", className: "bg-line" },
  { token: "hazard", hex: "#F5B800", use: "Needs attention, record ring", className: "bg-hazard" },
  { token: "hazard-ink", hex: "#8A6A00", use: "Text on hazard tints", className: "bg-hazard-ink" },
  { token: "convoy", hex: "#1E6E4B", use: "Sent, approved, passed", className: "bg-convoy" },
  { token: "flag", hex: "#C43D1F", use: "Alerts, failed checks, destructive", className: "bg-flag" },
];

const TYPE = [
  { name: "caption", spec: "13 / 18", className: "text-caption", sample: "Sent 6:42 pm, from phone" },
  { name: "body", spec: "15 / 22", className: "text-body", sample: "Say where you went, the odometer reading, fuel you bought, and anything that happened." },
  { name: "body-lg", spec: "17 / 24", className: "text-body-lg", sample: "Send your report before 8:00 pm" },
  { name: "heading", spec: "22 / 26 condensed", className: "font-display text-heading font-bold", sample: "What the driver said" },
  { name: "title", spec: "30 / 32 condensed", className: "font-display text-title font-bold", sample: "Tuesday 2 Sep" },
  { name: "hero", spec: "44 / 44 condensed", className: "font-display text-hero font-bold tabular", sample: "214" },
  { name: "board", spec: "64 / 64 condensed", className: "font-display text-board font-bold tabular", sample: "08" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-6 pb-8">
      <h2 className="font-display text-heading font-bold">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-4 py-2">
      <span className="text-caption text-steel">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** Every primitive in every state. Not linked from the product; reachable at /dev/ui. */
export default function UiGalleryPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-6 py-10">
      <p className="text-caption text-steel">Field Ops Reporter</p>
      <h1 className="mt-2 font-display text-title font-bold">UI gallery</h1>
      <p className="mt-2 max-w-[70ch] text-body-lg text-steel">
        Tokens and primitives from docs/design-brief.md §3. Flat surfaces, 1px lines, no shadows, sentence case.
      </p>

      <div className="mt-8">
        <Section title="Color">
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {COLORS.map((color) => (
              <li key={color.token} className="border border-line">
                <div className={`h-16 ${color.className}`} />
                <div className="p-3">
                  <p className="font-display text-body-lg font-semibold">{color.token}</p>
                  <p className="text-caption text-steel tabular">{color.hex}</p>
                  <p className="mt-1 text-caption">{color.use}</p>
                </div>
              </li>
            ))}
          </ul>
          <Row label="Tints">
            <span className="bg-ink/6 px-3 py-2 text-body">ink 6% (odometer strip, row hover)</span>
            <span className="bg-hazard/12 px-3 py-2 text-body text-hazard-ink">hazard 12%</span>
            <span className="bg-convoy/12 px-3 py-2 text-body text-convoy">convoy 12%</span>
            <span className="bg-flag/12 px-3 py-2 text-body text-flag">flag 12%</span>
          </Row>
        </Section>

        <Section title="Type">
          <ul className="divide-y divide-line">
            {TYPE.map((step) => (
              <li key={step.name} className="grid grid-cols-[160px_1fr] items-baseline gap-4 py-3">
                <span className="text-caption text-steel">
                  {step.name} <span className="tabular">{step.spec}</span>
                </span>
                <span className={step.className}>{step.sample}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="OdometerDigits">
          <Row label="hero, with unit">
            <OdometerDigits value={214} unit="km" />
            <OdometerDigits value={48} unit="L" />
          </Row>
          <Row label="hero, grouped">
            <OdometerDigits value={184220} />
            <OdometerDigits value={1234567} />
            <OdometerDigits value={1250000} unit="₦" />
          </Row>
          <Row label="hero, decimals">
            <OdometerDigits value={5.4} unit="km/L" maximumFractionDigits={1} />
          </Row>
          <Row label="hero, timer">
            <OdometerDigits value="0:14" />
          </Row>
          <Row label="board">
            <OdometerDigits value={8} size="board" />
            <OdometerDigits value={3} size="board" />
            <OdometerDigits value={12480} size="board" unit="km" />
          </Row>
          <Row label="board, empty org">
            <OdometerDigits value="00" size="board" className="text-steel" />
          </Row>
        </Section>

        <Section title="StatusChip">
          <Row label="field">
            {CHIP_STATUSES.map((status) => (
              <StatusChip key={status} status={status} surface="field" count={status === "alert" ? 1 : undefined} />
            ))}
          </Row>
          <Row label="admin">
            {CHIP_STATUSES.map((status) => (
              <StatusChip key={status} status={status} surface="admin" count={status === "alert" ? 2 : undefined} />
            ))}
          </Row>
          <Row label="alert, no count">
            <StatusChip status="alert" surface="admin" />
          </Row>
        </Section>

        <Section title="Button">
          <Row label="primary">
            <Button>Send report</Button>
            <Button disabled>Send report</Button>
            <Button size="field">Record today&rsquo;s report</Button>
            <Button size="field" disabled>
              Send report
            </Button>
          </Row>
          <Row label="secondary">
            <Button variant="secondary">Record another</Button>
            <Button variant="secondary" disabled>
              Record another
            </Button>
            <Button variant="secondary" size="field">
              Record another
            </Button>
          </Row>
          <Row label="destructive">
            <Button variant="destructive">Reject</Button>
            <Button variant="destructive" disabled>
              Reject
            </Button>
            <Button variant="destructive" size="field">
              Reject
            </Button>
          </Row>
          <Row label="text">
            <Button variant="text">Re-record</Button>
            <Button variant="text" disabled>
              Re-record
            </Button>
            <Button variant="text" size="field">
              Skip for now
            </Button>
          </Row>
          <Row label="block">
            <div className="w-full max-w-[358px]">
              <Button size="field" block>
                Record today&rsquo;s report
              </Button>
            </div>
          </Row>
          <Row label="loading">
            <LoadingButtons />
          </Row>
        </Section>

        <Section title="Input, Select, Textarea">
          <div className="grid max-w-[720px] grid-cols-1 gap-5 sm:grid-cols-2">
            <Input label="Business name" placeholder="Demo Haulage Ltd" />
            <Input label="Plate" defaultValue="KTU 421 XA" inputClassName="font-display font-bold tabular" />
            <Input label="Field size (56px)" size="field" placeholder="musa@example.com" type="email" />
            <Input label="With hint" placeholder="184 220" hint="Kilometres on the dashboard right now." />
            <Input label="With error" defaultValue="KTU 421 XA" error="That plate is already added. Enter a different one." />
            <Input label="Disabled" defaultValue="Read only" disabled />
            <Select label="Timezone" defaultValue="Africa/Lagos">
              <option value="Africa/Lagos">Africa/Lagos</option>
              <option value="Africa/Abuja">Africa/Abuja</option>
            </Select>
            <Select label="Select with error" defaultValue="" error="Pick a role.">
              <option value="">Choose a role</option>
              <option value="field">Driver</option>
            </Select>
            <Textarea label="Typed note" placeholder="Anything else the office should know" className="sm:col-span-2" />
            <Textarea
              label="Textarea with error"
              defaultValue="Motor spoil for Lokoja."
              error="Add the odometer reading as well."
              className="sm:col-span-2"
            />
          </div>
        </Section>

        <Section title="ProgressLine">
          <ProgressLineDemo />
        </Section>

        <Section title="Sheet and Drawer">
          <Row label="Sheet (field)">
            <SheetDemo />
          </Row>
          <Row label="Drawer (admin)">
            <DrawerDemo />
          </Row>
        </Section>
      </div>
    </main>
  );
}
