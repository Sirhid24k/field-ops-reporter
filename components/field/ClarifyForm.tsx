"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ProgressLine, Sheet, Textarea } from "@/components/ui";
import type { PendingReport } from "@/lib/queue";
import type { RecorderFailureKind, Recording } from "@/lib/recorder";
import { uuid } from "@/lib/uuid";
import { useFieldNetwork, type SubmitOutcome } from "./FieldShell";
import { BottomZone } from "./Frame";
import { RecordControl } from "./RecordControl";

export type ClarifyFormProps = {
  reportId: string;
  vehicleId: string;
  reportDate: string;
  /** "Your report, Tuesday 2 Sep, Kaduna → Kano" */
  summary: string;
  questions: string[];
};

/** F4 — One more thing: the question(s), a voice or typed answer, Send answer. */
export function ClarifyForm({ reportId, vehicleId, reportDate, summary, questions }: ClarifyFormProps) {
  const router = useRouter();
  const { submit } = useFieldNetwork();

  const [recording, setRecording] = useState<Recording | null>(null);
  const [answer, setAnswer] = useState("");
  const [micUnavailable, setMicUnavailable] = useState<RecorderFailureKind | null>(null);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Exclude<SubmitOutcome, "sent"> | null>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (micUnavailable) answerRef.current?.focus();
  }, [micUnavailable]);

  const onUnavailable = useCallback((kind: RecorderFailureKind) => setMicUnavailable(kind), []);

  const canSend = !sending && (recording !== null || answer.trim().length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    const now = Date.now();
    const item: PendingReport = {
      clientUuid: uuid(),
      kind: "clarification",
      reportId,
      vehicleId,
      reportDate,
      blob: recording?.blob ?? null,
      mimeType: recording?.mimeType ?? null,
      durationS: recording?.durationS ?? null,
      typedNote: answer.trim() || null,
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
    };
    const result = await submit(item);
    setSending(false);
    if (result === "sent") {
      router.replace("/app");
      return;
    }
    setOutcome(result);
  };

  const done = () => {
    setOutcome(null);
    router.replace("/app");
  };

  return (
    <>
      <p className="mt-2 text-body text-steel">{summary}</p>
      <div className="mt-4 space-y-2">
        {questions.map((question, index) => (
          <p key={index} className="text-body-lg">
            {question}
          </p>
        ))}
      </div>

      <div className="mt-8 flex flex-col">
        <RecordControl
          recording={recording}
          onRecorded={setRecording}
          onReRecord={() => setRecording(null)}
          onUnavailable={onUnavailable}
          idleCopy="Tap to answer out loud"
          typedNoun="answer"
          disabled={sending}
        />
        <Textarea
          ref={answerRef}
          label={micUnavailable ? "Your answer" : "Or type your answer"}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          disabled={sending}
          className="mt-6"
        />
      </div>

      <BottomZone>
        <ProgressLine active={sending} label="Sending answer" />
        <Button size="field" block disabled={!canSend} loading={sending} loadingLabel="Sending…" onClick={send}>
          Send answer
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
    </>
  );
}
