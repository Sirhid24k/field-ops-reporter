"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, ProgressLine, Sheet, Textarea } from "@/components/ui";
import { dateInZone } from "@/lib/dates";
import type { PendingReport } from "@/lib/queue";
import type { RecorderFailureKind, Recording } from "@/lib/recorder";
import { uuid } from "@/lib/uuid";
import { readVehicleChoice, setVehicleChoice, subscribeVehicleChoice } from "@/lib/vehicle-choice";
import { useFieldNetwork, type SubmitOutcome } from "./FieldShell";
import { BottomZone } from "./Frame";
import { RecordControl } from "./RecordControl";
import { VehicleSheet, type VehicleOption } from "./VehicleSheet";

export type NewReportFormProps = {
  vehicles: VehicleOption[];
  defaultVehicleId: string | null;
  timezone: string;
};

/** F3 — New report: idle, recording, recorded, mic denied, sending, and the queued sheet. */
export function NewReportForm({ vehicles, defaultVehicleId, timezone }: NewReportFormProps) {
  const router = useRouter();
  const { submit } = useFieldNetwork();

  const stored = useSyncExternalStore(subscribeVehicleChoice, readVehicleChoice, () => null);
  const vehicleId = stored && vehicles.some((vehicle) => vehicle.id === stored) ? stored : defaultVehicleId;
  const vehicle = vehicles.find((entry) => entry.id === vehicleId) ?? null;

  const [recording, setRecording] = useState<Recording | null>(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [micUnavailable, setMicUnavailable] = useState<RecorderFailureKind | null>(null);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<SubmitOutcome, "sent"> | null>(null);
  const [vehicleSheet, setVehicleSheet] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  const onUnavailable = useCallback((kind: RecorderFailureKind) => {
    setMicUnavailable(kind);
    setNoteOpen(true);
  }, []);

  const canSend = !sending && Boolean(vehicleId) && (recording !== null || note.trim().length > 0);

  const send = async () => {
    if (!vehicleId || !canSend) return;
    setSending(true);
    const now = Date.now();
    const item: PendingReport = {
      clientUuid: uuid(),
      kind: "report",
      vehicleId,
      reportDate: dateInZone(new Date(), timezone),
      blob: recording?.blob ?? null,
      mimeType: recording?.mimeType ?? null,
      durationS: recording?.durationS ?? null,
      typedNote: note.trim() || null,
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
    };
    const result = await submit(item);
    if (result === "sent") {
      router.replace("/app"); // stays in the sending state until Today takes over
      return;
    }
    setSending(false);
    setOutcome(result);
  };

  const done = () => {
    setOutcome(null);
    router.replace("/app");
  };

  return (
    <>
      <div className="mt-2 flex min-h-12 items-center justify-between">
        {vehicle ? (
          <span className="font-display text-heading font-bold tabular">{vehicle.plate_number}</span>
        ) : (
          <span className="text-body text-steel">No vehicle yet. Ask the office to add one.</span>
        )}
        {vehicles.length > 1 ? (
          <Button variant="text" onClick={() => setVehicleSheet(true)} disabled={sending}>
            Change
          </Button>
        ) : null}
      </div>

      <div className="mt-8 flex flex-col">
        <RecordControl
          recording={recording}
          onRecorded={setRecording}
          onReRecord={() => setRecording(null)}
          onUnavailable={onUnavailable}
          disabled={sending}
        />

        {micUnavailable ? null : (
          <p className="mt-6 text-body text-steel">
            Say where you went, the odometer reading, fuel you bought, and anything that happened.
          </p>
        )}

        {noteOpen ? (
          <Textarea
            ref={noteRef}
            label={micUnavailable ? "Your report" : "Typed note"}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={sending}
            className="mt-6"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            disabled={sending}
            className="mt-6 flex min-h-14 w-full items-center justify-between border-y border-line text-left text-body-lg"
          >
            Add a typed note
            <span aria-hidden="true" className="font-display text-heading font-semibold">
              +
            </span>
          </button>
        )}
      </div>

      <BottomZone>
        <ProgressLine active={sending} label="Sending report" />
        <Button size="field" block disabled={!canSend} loading={sending} loadingLabel="Sending…" onClick={send}>
          Send report
        </Button>
      </BottomZone>

      <Sheet open={outcome !== null} onClose={done}>
        <p className="text-body-lg">
          {outcome === "failed"
            ? "Upload failed. It’s saved on your phone and will retry."
            : "Saved on your phone. It’ll send when you’re online."}
        </p>
        <Button size="field" block className="mt-6" onClick={done}>
          Done
        </Button>
      </Sheet>

      <VehicleSheet
        open={vehicleSheet}
        vehicles={vehicles}
        selectedId={vehicleId}
        onSelect={(id) => {
          setVehicleChoice(id);
          setVehicleSheet(false);
        }}
        onClose={() => setVehicleSheet(false)}
      />
    </>
  );
}
