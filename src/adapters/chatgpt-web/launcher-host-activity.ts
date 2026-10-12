const inFlight = new Map<string, number>();

export function markLauncherHostBusy(host: string): () => void {
  inFlight.set(host, (inFlight.get(host) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (inFlight.get(host) ?? 1) - 1;
    if (left > 0) inFlight.set(host, left);
    else inFlight.delete(host);
  };
}

export function launcherHostHasTurn(host: string): boolean {
  return (inFlight.get(host) ?? 0) > 0;
}

/** True while the launcher has an active turn or session probe. */
export const launcherDescriptorHasTurn = launcherHostHasTurn;

/** Test hook for the process-wide activity registry. */
export function clearLauncherHostActivity(): void {
  inFlight.clear();
}
