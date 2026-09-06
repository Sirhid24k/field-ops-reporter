/**
 * The offline queue (session-2 prompt §3). Browser-only.
 *
 * Every submit is written to IndexedDB first (`pending_reports`) and then flushed.
 * A flush sends each due item through the upload path in app/(field)/app/actions.ts:
 * create the row → PUT the blob to the signed URL → confirm. The server is idempotent
 * on the client UUID, so a retry after a dropped connection never duplicates a report.
 *
 * Nothing here blocks the UI on the network: callers await a flush only to decide
 * which copy to show ("sent" vs "saved on your phone").
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  answerClarification,
  createReport,
  markAnswerUploaded,
  markUploaded,
  type ActionFailure,
} from "@/app/(field)/app/actions";

export type PendingKind = "report" | "clarification";

export type PendingReport = {
  /** Idempotency key; also the store key. */
  clientUuid: string;
  kind: PendingKind;
  vehicleId: string;
  /** YYYY-MM-DD in the organisation's timezone, fixed at record time. */
  reportDate: string;
  blob: Blob | null;
  mimeType: string | null;
  durationS: number | null;
  typedNote: string | null;
  /** The report a clarification answer belongs to. */
  reportId?: string;
  createdAt: number;
  attempts: number;
  /** Exponential backoff: the flush skips an item until this time unless forced. */
  nextAttemptAt: number;
  lastError?: string;
};

interface QueueSchema extends DBSchema {
  pending_reports: {
    key: string;
    value: PendingReport;
    indexes: { "by-created": number };
  };
}

const DB_NAME = "field-ops-reporter";
const DB_VERSION = 1;
const STORE = "pending_reports";

let database: Promise<IDBPDatabase<QueueSchema>> | null = null;

function db(): Promise<IDBPDatabase<QueueSchema>> {
  if (!database) {
    database = openDB<QueueSchema>(DB_NAME, DB_VERSION, {
      upgrade(upgrading) {
        const store = upgrading.createObjectStore(STORE, { keyPath: "clientUuid" });
        store.createIndex("by-created", "createdAt");
      },
    });
  }
  return database;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called after every change to the store (add, update, remove). */
export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Everything still waiting to go, oldest first. */
export async function listPending(): Promise<PendingReport[]> {
  return (await db()).getAllFromIndex(STORE, "by-created");
}

export async function addPending(item: PendingReport): Promise<void> {
  await (await db()).put(STORE, item);
  emit();
}

async function updatePending(item: PendingReport): Promise<void> {
  await (await db()).put(STORE, item);
  emit();
}

export async function removePending(clientUuid: string): Promise<void> {
  await (await db()).delete(STORE, clientUuid);
  emit();
}

// ---------------------------------------------------------------------------
// sending
// ---------------------------------------------------------------------------

export class SubmitError extends Error {
  code: ActionFailure["code"];
  constructor(code: ActionFailure["code"], message: string) {
    super(message);
    this.name = "SubmitError";
    this.code = code;
  }
}

/** True for the failures that mean "no server right now" rather than "the server said no". */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof SubmitError) return false;
  if (error instanceof DOMException) return error.name === "AbortError" || error.name === "NetworkError";
  if (error instanceof TypeError) return true; // fetch: "Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource"
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|network|load failed|offline/i.test(message);
}

const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000;

/** PUTs the blob to a signed upload URL (the token is in the URL). */
async function putToSignedUrl(url: string, blob: Blob, mimeType: string | null): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "PUT",
      body: blob,
      headers: {
        "content-type": mimeType || blob.type || "application/octet-stream",
        "cache-control": "max-age=3600",
        "x-upsert": "true",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new SubmitError("failed", `Upload failed (${response.status}).`);
  } finally {
    clearTimeout(timeout);
  }
}

/** Sends one item now, without touching the store. The shell uses it when IndexedDB is unavailable. */
export async function sendPending(item: PendingReport): Promise<void> {
  return send(item);
}

async function send(item: PendingReport): Promise<void> {
  if (item.kind === "report") {
    const created = await createReport({
      clientUuid: item.clientUuid,
      vehicleId: item.vehicleId,
      reportDate: item.reportDate,
      durationS: item.durationS,
      typedNote: item.typedNote,
      hasAudio: Boolean(item.blob),
      mimeType: item.mimeType,
    });
    if (!created.ok) throw new SubmitError(created.code, created.message);
    if (created.upload && item.blob) {
      await putToSignedUrl(created.upload.url, item.blob, item.mimeType);
      const marked = await markUploaded({ reportId: created.reportId, path: created.upload.path });
      if (!marked.ok) throw new SubmitError(marked.code, marked.message);
    }
    return;
  }

  if (!item.reportId) throw new SubmitError("invalid", "This answer lost track of its report.");
  const answered = await answerClarification({
    reportId: item.reportId,
    hasAudio: Boolean(item.blob),
    mimeType: item.mimeType,
    durationS: item.durationS,
    typedNote: item.typedNote,
  });
  if (!answered.ok) throw new SubmitError(answered.code, answered.message);
  if (answered.upload && item.blob) {
    await putToSignedUrl(answered.upload.url, item.blob, item.mimeType);
    const marked = await markAnswerUploaded({ reportId: item.reportId, path: answered.upload.path, typedNote: item.typedNote });
    if (!marked.ok) throw new SubmitError(marked.code, marked.message);
  }
}

// ---------------------------------------------------------------------------
// flushing
// ---------------------------------------------------------------------------

export type FlushFailure = { clientUuid: string; offline: boolean; message: string };
export type FlushResult = { sent: string[]; failed: FlushFailure[] };

/** 10s, 20s, 40s … capped at five minutes. The online event and a visible tab reset it. */
function backoffMs(attempts: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

let inFlight: Promise<FlushResult> | null = null;

/**
 * Sends every due item, one at a time. Flushes never overlap: a second caller waits for
 * the current pass and then runs its own, so a submit during a background flush still
 * gets its turn. `force` ignores per-item backoff (used on the online event and on submit).
 */
export async function flushQueue({ force = false }: { force?: boolean } = {}): Promise<FlushResult> {
  if (inFlight) await inFlight.catch(() => undefined);
  const pass = run(force);
  inFlight = pass;
  try {
    return await pass;
  } finally {
    if (inFlight === pass) inFlight = null;
  }
}

async function run(force: boolean): Promise<FlushResult> {
  const result: FlushResult = { sent: [], failed: [] };
  const items = await listPending();
  if (items.length === 0) return result;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    result.failed = items.map((item) => ({ clientUuid: item.clientUuid, offline: true, message: "Offline" }));
    return result;
  }

  for (const item of items) {
    if (!force && item.nextAttemptAt > Date.now()) continue;
    try {
      await send(item);
      await removePending(item.clientUuid);
      result.sent.push(item.clientUuid);
    } catch (error) {
      const offline = isNetworkError(error);
      const message = error instanceof Error ? error.message : "Couldn't send.";
      const attempts = item.attempts + 1;
      await updatePending({ ...item, attempts, nextAttemptAt: Date.now() + backoffMs(attempts), lastError: message });
      result.failed.push({ clientUuid: item.clientUuid, offline, message });
      // no server, or no session: the rest would fail the same way
      if (offline || (error instanceof SubmitError && error.code === "unauthenticated")) break;
    }
  }
  return result;
}
