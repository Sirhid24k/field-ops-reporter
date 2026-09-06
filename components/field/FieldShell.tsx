"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  addPending,
  flushQueue,
  isNetworkError,
  listPending,
  sendPending,
  subscribeQueue,
  type FlushResult,
  type PendingReport,
} from "@/lib/queue";

/**
 * Client shell for every field route: connectivity, the offline queue and the service worker.
 *
 * - `online` is false when `navigator.onLine` is false or the last ping to /api/ping failed.
 * - The queue is flushed on submit, on the `online` event, when the tab becomes visible,
 *   and every 30 seconds. Nothing blocks on the network.
 * - The service worker only caches the app shell; the queue lives here, in app code.
 */

export type SubmitOutcome = "sent" | "offline" | "failed";

type FieldNetwork = {
  online: boolean;
  /** Items still on this phone, oldest first. */
  pending: PendingReport[];
  /** False until IndexedDB has been read once (avoids a flash of the wrong card). */
  pendingLoaded: boolean;
  /** Bumped when a flush sends something, so Today can refresh its data. */
  lastSentAt: number;
  /** Queue first, then try to send now. Resolves with what to tell the driver. */
  submit: (item: PendingReport) => Promise<SubmitOutcome>;
  flushNow: (force?: boolean) => Promise<FlushResult>;
};

const FieldNetworkContext = createContext<FieldNetwork | null>(null);

const TICK_MS = 30_000;
const PING_TIMEOUT_MS = 6_000;

async function pingServer(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetch("/api/ping", { cache: "no-store", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function subscribeToNavigator(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "1";
  if (!enabled) {
    // a worker left over from a production run would serve stale chunks to the dev server
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    });
    return;
  }
  void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
}

export function FieldShell({ children }: { children: ReactNode }) {
  // navigator.onLine is authoritative for "no network at all"; the ping covers "network but no server"
  const navigatorOnline = useSyncExternalStore(
    subscribeToNavigator,
    () => navigator.onLine,
    () => true,
  );
  const [serverReachable, setServerReachable] = useState(true);
  const online = navigatorOnline && serverReachable;
  const [pending, setPending] = useState<PendingReport[]>([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [lastSentAt, setLastSentAt] = useState(0);
  const pendingCount = useRef(0);

  const refreshPending = useCallback(async () => {
    try {
      const items = await listPending();
      pendingCount.current = items.length;
      setPending(items);
    } catch {
      // IndexedDB unavailable (private mode on some browsers): the app still works online
    } finally {
      setPendingLoaded(true);
    }
  }, []);

  const flushNow = useCallback(async (force = false): Promise<FlushResult> => {
    const result = await flushQueue({ force });
    if (result.sent.length > 0) {
      setLastSentAt(Date.now());
      setServerReachable(true);
    }
    if (result.failed.some((failure) => failure.offline)) setServerReachable(false);
    return result;
  }, []);

  const submit = useCallback(
    async (item: PendingReport): Promise<SubmitOutcome> => {
      try {
        await addPending(item);
      } catch {
        // no IndexedDB (some private modes): send straight away rather than lose the report
        try {
          await sendPending(item);
          setLastSentAt(Date.now());
          return "sent";
        } catch (error) {
          return isNetworkError(error) ? "offline" : "failed";
        }
      }
      const result = await flushNow(true);
      if (result.sent.includes(item.clientUuid)) return "sent";
      const failure = result.failed.find((entry) => entry.clientUuid === item.clientUuid);
      return failure && !failure.offline ? "failed" : "offline";
    },
    [flushNow],
  );

  /**
   * Ping, then flush whatever is waiting. The periodic tick only runs while the tab is
   * visible (battery); the first check and the online event always run, so a report sent
   * from a backgrounded app still goes as soon as the page loads or the network returns.
   */
  const check = useCallback(
    async (force: boolean, { onlyWhenVisible = false }: { onlyWhenVisible?: boolean } = {}) => {
      if (!navigator.onLine) return;
      if (onlyWhenVisible && document.visibilityState !== "visible") return;
      const reachable = await pingServer();
      setServerReachable(reachable);
      if (reachable && pendingCount.current > 0) await flushNow(force);
    },
    [flushNow],
  );

  useEffect(() => {
    registerServiceWorker();
    const unsubscribe = subscribeQueue(() => void refreshPending());
    // first read of the queue and first ping, off the render path
    const initial = setTimeout(() => {
      void refreshPending();
      void check(true);
    }, 0);

    const onOnline = () => void check(true);
    const onVisibility = () => void check(true);

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => void check(false, { onlyWhenVisible: true }), TICK_MS);

    return () => {
      clearTimeout(initial);
      unsubscribe();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [check, refreshPending]);

  const value = useMemo<FieldNetwork>(
    () => ({ online, pending, pendingLoaded, lastSentAt, submit, flushNow }),
    [online, pending, pendingLoaded, lastSentAt, submit, flushNow],
  );

  return <FieldNetworkContext.Provider value={value}>{children}</FieldNetworkContext.Provider>;
}

export function useFieldNetwork(): FieldNetwork {
  const value = useContext(FieldNetworkContext);
  if (!value) throw new Error("useFieldNetwork must be used inside FieldShell");
  return value;
}
