"use client";

import { useEffect, useRef, useState } from "react";
import { signAudio } from "@/app/(admin)/dashboard/reports/[id]/actions";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/report-audio";

export type AudioPlayerProps = {
  reportId: string;
  /** Set for a voice answer to a clarification; otherwise the report's own recording. */
  clarificationId?: string;
  /** The clock duration stored at upload time; MediaRecorder's webm carries no duration header. */
  durationS: number | null;
  label?: string;
};

const RATES = [1, 1.5] as const;

/**
 * Play, scrubber, duration, 1× / 1.5× (design-brief §5 A2). The signed URL is fetched on the
 * first press of Play, so a page left open does not hold an expired link, and no URL is
 * minted for a report nobody listens to.
 */
export function AudioPlayer({ reportId, clarificationId, durationS, label = "Recording" }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number>(durationS ?? 0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [error, setError] = useState<string | null>(null);
  const wantsPlay = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url || !wantsPlay.current) return;
    wantsPlay.current = false;
    audio.playbackRate = rate;
    audio.play().catch(() => setError("The recording couldn't be played. Reload the page and try again."));
  }, [url, rate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (playing) {
      audio.pause();
      return;
    }
    if (url) {
      audio.play().catch(() => setError("The recording couldn't be played. Reload the page and try again."));
      return;
    }
    setLoading(true);
    const result = await signAudio({ reportId, clarificationId });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    wantsPlay.current = true;
    setUrl(result.url);
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !url) return;
    audio.currentTime = seconds;
    setPosition(seconds);
  }

  function onMetadata() {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    } else if (!durationS) {
      // webm from MediaRecorder reports Infinity until the browser has scanned to the end
      const settle = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        audio.currentTime = 0;
        audio.removeEventListener("timeupdate", settle);
      };
      audio.addEventListener("timeupdate", settle);
      audio.currentTime = 1e101;
    }
  }

  const max = duration > 0 ? duration : 1;

  return (
    <div className="rounded-control border border-line p-3">
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setPosition(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={onMetadata}
        onDurationChange={onMetadata}
        onError={() => setError("The recording couldn't be loaded. Reload the page and try again.")}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={toggle} loading={loading} loadingLabel="Loading…" className="min-w-[5.5rem]" aria-label={`${playing ? "Pause" : "Play"} ${label.toLowerCase()}`}>
          {playing ? "Pause" : "Play"}
        </Button>
        <input
          type="range"
          aria-label={`Position in ${label.toLowerCase()}`}
          min={0}
          max={max}
          step={0.1}
          value={Math.min(position, max)}
          onChange={(event) => seek(Number(event.target.value))}
          disabled={!url}
          className="h-11 min-w-[8rem] flex-1 accent-ink disabled:opacity-60"
        />
        <span className="font-display text-body-lg font-semibold tabular" aria-live="off">
          {formatDuration(position)} / {duration > 0 ? formatDuration(duration) : "–:––"}
        </span>
        <div role="group" aria-label="Speed" className="flex gap-1">
          {RATES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rate === value}
              onClick={() => setRate(value)}
              className={cn(
                "min-h-9 rounded-control border px-2.5 font-display text-body font-semibold tabular",
                rate === value ? "border-ink bg-ink text-paper" : "border-line text-steel hover:text-ink",
              )}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-caption text-flag">
          {error}
        </p>
      ) : null}
    </div>
  );
}
