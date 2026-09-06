"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, OdometerDigits } from "@/components/ui";
import { cn } from "@/lib/cn";
import { LEVEL_BARS, Recorder, RecorderFailure, type RecorderFailureKind, type Recording } from "@/lib/recorder";
import { formatDuration } from "@/lib/report-audio";

export type RecordControlProps = {
  /** The finished recording, owned by the parent (null = nothing recorded yet). */
  recording: Recording | null;
  onRecorded: (recording: Recording) => void;
  /** "Re-record": the parent drops the recording and the control returns to idle. */
  onReRecord: () => void;
  /** The microphone could not be used; the parent opens and focuses the typed field. */
  onUnavailable?: (kind: RecorderFailureKind) => void;
  /** Copy under the idle disc. F3: "Hold to record, or tap to start". F4: "Tap to answer out loud". */
  idleCopy?: string;
  /** Which word the unavailable notice uses: "Type your report below instead." */
  typedNoun?: "report" | "answer";
  disabled?: boolean;
};

/** A press shorter than this is a tap (recording continues until the next tap); longer is a hold. */
const HOLD_MS = 400;
const TICK_MS = 250;

const UNAVAILABLE_COPY: Record<RecorderFailureKind, (noun: string) => string> = {
  denied: (noun) => `Your browser blocked the microphone. Type your ${noun} below instead.`,
  "no-mic": (noun) => `No microphone was found. Type your ${noun} below instead.`,
  unsupported: (noun) => `This browser can't record audio. Type your ${noun} below instead.`,
  busy: (noun) => `Another app is using the microphone. Type your ${noun} below instead.`,
  failed: (noun) => `Recording didn't start. Type your ${noun} below instead.`,
};

type Phase = "idle" | "starting" | "recording" | "stopping";

/**
 * The record control from design-brief §2/§4: a 120px ink disc inside a hazard ring.
 * Hold to record (release stops) or tap to start (tap again to stop). While recording the
 * ring fills solid hazard, the disc shows a stop square, the timer runs in hero digits and
 * 24 thin bars follow the microphone. Once recorded it shrinks to a play button, the
 * duration and a Re-record text button.
 */
export function RecordControl({
  recording,
  onRecorded,
  onReRecord,
  onUnavailable,
  idleCopy = "Hold to record, or tap to start",
  typedNoun = "report",
  disabled = false,
}: RecordControlProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [unavailable, setUnavailable] = useState<RecorderFailureKind | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hitLimit, setHitLimit] = useState(false);

  const recorderRef = useRef<Recorder | null>(null);
  const pressRef = useRef<{ startedAt: number } | null>(null);
  const stopWhenStartedRef = useRef(false);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const levelsRef = useRef(new Float32Array(LEVEL_BARS));
  const onRecordedRef = useRef(onRecorded);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
    onUnavailableRef.current = onUnavailable;
  }, [onRecorded, onUnavailable]);

  const finish = useCallback((result: Recording) => {
    recorderRef.current = null;
    setPhase("idle");
    setElapsedMs(0);
    setHitLimit(result.hitLimit);
    onRecordedRef.current(result);
  }, []);

  const fail = useCallback((kind: RecorderFailureKind) => {
    recorderRef.current = null;
    setPhase("idle");
    setElapsedMs(0);
    setUnavailable(kind);
    onUnavailableRef.current?.(kind);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setPhase("stopping");
    recorder
      .stop()
      .then(finish)
      .catch((error: unknown) => fail(error instanceof RecorderFailure ? error.kind : "failed"));
  }, [fail, finish]);

  const begin = useCallback(() => {
    if (recorderRef.current) return;
    const recorder = new Recorder({ onLimit: finish });
    recorderRef.current = recorder;
    stopWhenStartedRef.current = false;
    setPhase("starting");
    setHitLimit(false);
    recorder
      .start()
      .then(() => {
        if (recorderRef.current !== recorder) return; // cancelled while the permission prompt was up
        setPhase("recording");
        if (stopWhenStartedRef.current) stop();
      })
      .catch((error: unknown) => {
        if (recorderRef.current !== recorder) return;
        fail(error instanceof RecorderFailure ? error.kind : "failed");
      });
  }, [fail, finish, stop]);

  // timer + level bars while recording; nothing moves when there is no input
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setElapsedMs(recorderRef.current?.elapsedMs ?? 0), TICK_MS);
    let frame = 0;
    const draw = () => {
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.levels(levelsRef.current);
        for (let index = 0; index < LEVEL_BARS; index += 1) {
          const bar = barsRef.current[index];
          if (bar) bar.style.height = `${Math.max(2, Math.round(levelsRef.current[index] * 40))}px`;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(frame);
    };
  }, [phase]);

  // leaving the screen mid-recording throws the capture away
  useEffect(() => () => recorderRef.current?.cancel(), []);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (phase === "recording") {
      stop(); // tap to stop
      return;
    }
    if (phase === "idle") {
      pressRef.current = { startedAt: performance.now() };
      begin();
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture was never taken
    }
    if (!press) return;
    const held = performance.now() - press.startedAt;
    if (held < HOLD_MS) return; // a tap: keep recording until the next tap
    if (phase === "recording") stop();
    else stopWhenStartedRef.current = true; // held through the permission prompt: stop as soon as it starts
  };

  const onKeyboardActivate = (event: React.MouseEvent<HTMLButtonElement>) => {
    // detail 0 = keyboard or assistive tech; pointer presses are handled above
    if (event.detail !== 0 || disabled) return;
    if (phase === "recording") stop();
    else if (phase === "idle") begin();
  };

  const reRecord = () => {
    setHitLimit(false);
    onReRecord();
  };

  if (unavailable) {
    return (
      <div role="status" className="rounded-control border border-ink px-4 py-3 text-body-lg">
        {UNAVAILABLE_COPY[unavailable](typedNoun)}
      </div>
    );
  }

  if (recording) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Playback recording={recording} onReRecord={reRecord} disabled={disabled} />
        {hitLimit ? (
          <p role="status" className="text-center text-body text-steel">
            Recording stopped at 3:00, the most one report can hold. Send it, or re-record.
          </p>
        ) : null}
      </div>
    );
  }

  const isRecording = phase === "recording" || phase === "stopping";

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        aria-label={isRecording ? "Stop recording" : "Record"}
        aria-pressed={isRecording}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onKeyboardActivate}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          "flex size-[120px] touch-none select-none items-center justify-center rounded-full border-[6px] transition-colors duration-150",
          isRecording ? "border-hazard bg-hazard" : "border-hazard bg-transparent",
          disabled && "opacity-50",
        )}
      >
        <span className="flex size-[92px] items-center justify-center rounded-full bg-ink">
          {isRecording ? (
            <span aria-hidden="true" className="size-8 rounded-[3px] bg-paper" />
          ) : (
            <span aria-hidden="true" className="size-4 rounded-full bg-hazard" />
          )}
        </span>
      </button>

      {isRecording ? (
        <>
          <OdometerDigits value={formatDuration(elapsedMs / 1000)} />
          <div aria-hidden="true" className="flex h-10 items-end gap-[3px]">
            {Array.from({ length: LEVEL_BARS }, (_, index) => (
              <span
                key={index}
                ref={(element) => {
                  barsRef.current[index] = element;
                }}
                className="w-[3px] bg-ink"
                style={{ height: 2 }}
              />
            ))}
          </div>
          <p role="status" className="text-center text-body-lg">
            Recording… tap to stop.
          </p>
        </>
      ) : (
        <p className="text-center text-body-lg">{phase === "starting" ? "Starting…" : idleCopy}</p>
      )}
    </div>
  );
}

/** Recorded state: 56px play button, the duration, Re-record. */
function Playback({
  recording,
  onReRecord,
  disabled,
}: {
  recording: Recording;
  onReRecord: () => void;
  disabled: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionS, setPositionS] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(recording.blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    const onTime = () => setPositionS(audio.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setPositionS(0);
    };
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audioRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [recording.blob]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };

  const shown = playing ? Math.min(positionS, recording.durationS) : recording.durationS;

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={playing ? "Pause" : "Play recording"}
        className="flex size-14 items-center justify-center rounded-full bg-ink text-paper disabled:bg-steel"
      >
        {playing ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-1 size-6" fill="currentColor">
            <path d="M7 4.5v15l12-7.5z" />
          </svg>
        )}
      </button>
      <span className="font-display text-heading font-bold tabular" aria-live="off">
        {formatDuration(shown)}
      </span>
      <Button variant="text" onClick={onReRecord} disabled={disabled}>
        Re-record
      </Button>
    </div>
  );
}
