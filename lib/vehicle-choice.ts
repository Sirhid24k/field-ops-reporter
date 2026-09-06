/**
 * Which vehicle the driver last picked, kept on the phone so Today and New report agree
 * and so it survives being offline. A tiny external store for useSyncExternalStore.
 */

const KEY = "fo.vehicle";
const listeners = new Set<() => void>();

export function readVehicleChoice(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setVehicleChoice(vehicleId: string): void {
  try {
    window.localStorage.setItem(KEY, vehicleId);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  listeners.forEach((listener) => listener());
}

export function subscribeVehicleChoice(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
