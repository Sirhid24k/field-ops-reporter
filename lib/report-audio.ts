/**
 * Audio conventions shared by the recorder (browser) and the upload actions (server):
 * which containers we try, how hard we compress, where the files live in storage.
 */

/** Probed in order; the first one MediaRecorder supports wins. */
export const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

/** ~30 kbps: a three-minute report is well under a megabyte on a slow uplink. */
export const TARGET_AUDIO_BITS_PER_SECOND = 32_000;

/** Recordings are cut off gently at three minutes. */
export const MAX_RECORDING_MS = 3 * 60 * 1000;

export const REPORT_AUDIO_BUCKET = "report-audio";

export type AudioExtension = "webm" | "m4a" | "ogg";
export const AUDIO_EXTENSIONS: readonly AudioExtension[] = ["webm", "m4a", "ogg"];

/** File extension for a MediaRecorder MIME type (webm by default). */
export function extensionFor(mimeType: string | null | undefined): AudioExtension {
  const base = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/aac" || base === "audio/x-m4a") return "m4a";
  if (base === "audio/ogg") return "ogg";
  return "webm";
}

/** report-audio/{orgId}/{reportId}.{ext} */
export function reportAudioPath(orgId: string, reportId: string, mimeType: string | null | undefined): string {
  return `${orgId}/${reportId}.${extensionFor(mimeType)}`;
}

/** report-audio/{orgId}/{reportId}-clarify-{n}.{ext} */
export function clarificationAudioPath(
  orgId: string,
  reportId: string,
  round: number,
  mimeType: string | null | undefined,
): string {
  return `${orgId}/${reportId}-clarify-${round}.${extensionFor(mimeType)}`;
}

/** 14 → "0:14", 83 → "1:23". Timers and durations are always m:ss. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
