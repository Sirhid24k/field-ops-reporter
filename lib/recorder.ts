/**
 * MediaRecorder wrapper for the field app.
 *
 * - Picks the container by support probe (webm/opus first, mp4 for Safari).
 * - Asks for ~32 kbps so a report stays small on a slow uplink.
 * - Exposes input levels from an AnalyserNode for the 24 bars on the recording screen.
 * - Stops on its own at three minutes and tells the caller it did.
 *
 * Browser-only: every entry point checks for the APIs it needs.
 */

import { MAX_RECORDING_MS, MIME_CANDIDATES, TARGET_AUDIO_BITS_PER_SECOND } from "./report-audio";

export type Recording = {
  blob: Blob;
  mimeType: string;
  /** Whole seconds, measured by the clock rather than read from the container (webm from MediaRecorder carries no duration). */
  durationS: number;
  /** True when the three-minute cutoff ended the recording. */
  hitLimit: boolean;
};

export type RecorderFailureKind = "unsupported" | "denied" | "no-mic" | "busy" | "failed";

export class RecorderFailure extends Error {
  kind: RecorderFailureKind;
  constructor(kind: RecorderFailureKind, message?: string) {
    super(message ?? kind);
    this.name = "RecorderFailure";
    this.kind = kind;
  }
}

/** Number of level bars the recording screen draws. */
export const LEVEL_BARS = 24;

export function recorderSupport(): { supported: boolean; mimeType: string | undefined } {
  if (
    typeof window === "undefined" ||
    typeof MediaRecorder === "undefined" ||
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    return { supported: false, mimeType: undefined };
  }
  const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return { supported: true, mimeType };
}

/** getUserMedia rejection → what to tell the driver. */
export function classifyMediaError(error: unknown): RecorderFailureKind {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-mic";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "failed";
  }
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? scope.webkitAudioContext;
}

export type RecorderOptions = {
  /** Called with the finished recording when the three-minute cutoff stops it. */
  onLimit?: (recording: Recording) => void;
};

export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];
  private frequencies = new Uint8Array(32);
  private startedAt = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping: Promise<Recording> | null = null;
  private readonly options: RecorderOptions;

  constructor(options: RecorderOptions = {}) {
    this.options = options;
  }

  /** Asks for the microphone and starts capturing. Throws a RecorderFailure the UI can explain. */
  async start(): Promise<void> {
    const support = recorderSupport();
    if (!support.supported) throw new RecorderFailure("unsupported");

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      throw new RecorderFailure(classifyMediaError(error));
    }

    try {
      const Context = audioContextCtor();
      if (Context) {
        this.context = new Context();
        // a context made outside a user gesture starts suspended; the bars would stay flat
        void this.context.resume().catch(() => undefined);
        const source = this.context.createMediaStreamSource(this.stream);
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 64; // 32 bins; the UI reads 24 of them
        this.analyser.smoothingTimeConstant = 0.5;
        source.connect(this.analyser); // not connected to the speakers: no feedback loop
        this.frequencies = new Uint8Array(this.analyser.frequencyBinCount);
      }

      this.recorder = new MediaRecorder(this.stream, {
        ...(support.mimeType ? { mimeType: support.mimeType } : {}),
        audioBitsPerSecond: TARGET_AUDIO_BITS_PER_SECOND,
      });
    } catch (error) {
      this.release();
      throw new RecorderFailure("failed", error instanceof Error ? error.message : undefined);
    }

    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(500);
    this.startedAt = performance.now();

    this.limitTimer = setTimeout(() => {
      void this.stop(true)
        .then((recording) => this.options.onLimit?.(recording))
        .catch(() => undefined);
    }, MAX_RECORDING_MS);
  }

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  get elapsedMs(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  /** Fills `out` (0..1 per bar) from the analyser; zeros when there is no input. */
  levels(out: Float32Array): void {
    if (!this.analyser) {
      out.fill(0);
      return;
    }
    this.analyser.getByteFrequencyData(this.frequencies);
    const bins = this.frequencies.length;
    for (let index = 0; index < out.length; index += 1) {
      // skip the DC bin; spread the bars over the lower, voice-carrying bins
      const bin = Math.min(bins - 1, 1 + Math.floor((index * (bins - 4)) / out.length));
      out[index] = this.frequencies[bin] / 255;
    }
  }

  /** Stops capturing and resolves with the finished recording. Safe to call twice. */
  stop(hitLimit = false): Promise<Recording> {
    if (this.stopping) return this.stopping;
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new RecorderFailure("failed", "Not recording."));

    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    const durationS = Math.max(1, Math.round(this.elapsedMs / 1000));
    const fallbackMime = recorder.mimeType;

    this.stopping = new Promise<Recording>((resolve, reject) => {
      const finish = () => {
        const mimeType = recorder.mimeType || fallbackMime || "audio/webm";
        const blob = new Blob(this.chunks, { type: mimeType });
        this.release();
        if (blob.size === 0) reject(new RecorderFailure("failed", "Nothing was recorded."));
        else resolve({ blob, mimeType, durationS, hitLimit });
      };
      recorder.onstop = finish;
      recorder.onerror = () => {
        this.release();
        reject(new RecorderFailure("failed", "Recording stopped unexpectedly."));
      };
      if (recorder.state === "inactive") finish();
      else recorder.stop();
    });
    return this.stopping;
  }

  /** Throws the capture away (re-record, leaving the screen). */
  cancel(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    try {
      if (this.recorder && this.recorder.state !== "inactive") {
        this.recorder.onstop = null;
        this.recorder.stop();
      }
    } catch {
      // already stopped
    }
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }
}
