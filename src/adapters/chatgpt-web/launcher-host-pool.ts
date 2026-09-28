import { readLauncherBrowserHostDescriptor, type LauncherBrowserHostDescriptor } from "../../launcher-browser-host";

/**
 * Turns are placed on slots: a connector in a launcher browser. Slots may live in several launcher
 * processes (each its own Chromium, so a busy renderer cannot stall another browser's turns) or share
 * one launcher, where one ChatGPT login serves every slot and the launcher's own tabs isolate the
 * turns. Either way each slot's connector has its own tunnel. The broker stays single: tool calls
 * are routed by turn token, not by browser.
 */

/**
 * A pool member is a slot: one connector in one launcher browser, written `<descriptor>#<connector>`.
 * Several slots can share a browser, so one ChatGPT login serves them all while each connector keeps
 * its own tunnel (OpenAI dispatches one tool call at a time per tunnel). A bare descriptor path is a
 * whole legacy host whose connector comes from `browserHostAppNames`.
 */
export function launcherSlot(descriptor: string, appName: string): string {
  return `${descriptor}#${appName}`;
}

export function launcherSlotDescriptor(slot: string): string {
  const at = slot.indexOf("#");
  return at < 0 ? slot : slot.slice(0, at);
}

export function launcherSlotAppName(slot: string): string | undefined {
  const at = slot.indexOf("#");
  return at < 0 ? undefined : slot.slice(at + 1);
}

/** A retained ChatGPT conversation can only resume in the slot (browser tab and connector) that owns it. */
const LAUNCHER_HOST_AFFINITY_TTL_MS = 6 * 60 * 60_000;
const affinity = new Map<string, { host: string; at: number }>();

export function rememberLauncherHostAffinity(conversationKey: string, host: string, now = Date.now()): void {
  affinity.delete(conversationKey);
  affinity.set(conversationKey, { host, at: now });
  for (const [key, entry] of affinity) {
    if (now - entry.at < LAUNCHER_HOST_AFFINITY_TTL_MS && affinity.size <= 1_024) break;
    affinity.delete(key);
  }
}

export function launcherHostForConversation(conversationKey: string | undefined, now = Date.now()): string | undefined {
  if (!conversationKey) return undefined;
  const entry = affinity.get(conversationKey);
  if (!entry) return undefined;
  if (now - entry.at >= LAUNCHER_HOST_AFFINITY_TTL_MS) {
    affinity.delete(conversationKey);
    return undefined;
  }
  return entry.host;
}

/**
 * Hosts with a turn on them right now. The keep-alive must not reload a browser mid-turn, and the
 * count lives here rather than in one client instance because the bridge may hold several.
 */
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

/** Whether any slot of this browser has a turn, or the browser itself is held (keep-alive). */
export function launcherDescriptorHasTurn(descriptor: string): boolean {
  for (const [key, count] of inFlight) {
    if (count > 0 && launcherSlotDescriptor(key) === descriptor) return true;
  }
  return false;
}

/** Test hook: forget every conversation affinity. */
export function clearLauncherHostAffinity(): void {
  affinity.clear();
  quarantine.clear();
  inFlight.clear();
}

/**
 * A launcher whose page failed before a prompt could be sent (signed out, subscription not loaded,
 * navigation aborted) is left out of new turns for a while. Selection alone would keep choosing it:
 * an idle signed-out host always has the fewest turns, and a conversation that first landed there
 * sticks to it (on Mars one run's six attempts all went to the signed-out gamma).
 */
const LAUNCHER_HOST_QUARANTINE_MS = 10 * 60_000;
const quarantine = new Map<string, number>();

export function quarantineLauncherHost(host: string, now = Date.now()): void {
  quarantine.set(host, now + LAUNCHER_HOST_QUARANTINE_MS);
}

function quarantined(host: string, now: number): boolean {
  const until = quarantine.get(host);
  if (until === undefined) return false;
  if (until > now) return true;
  quarantine.delete(host);
  return false;
}

type DescriptorReader = (path: string) => unknown;

/**
 * A launcher is a candidate only while its descriptor is valid: owned by this user, private, and
 * naming a live launcher process. The primary is checked like every pool member, so a restarting or
 * crashed primary hands its turns to a live pool member instead of failing them. When nothing is
 * live the primary is still returned, so a single-launcher install fails exactly as before.
 */
export function availableLauncherHosts(
  primary: string,
  pool: readonly string[] = [],
  read: DescriptorReader = readLauncherBrowserHostDescriptor,
): string[] {
  const hosts: string[] = [];
  for (const host of [primary, ...pool]) {
    if (hosts.includes(host)) continue;
    try {
      read(launcherSlotDescriptor(host));
      hosts.push(host);
    } catch {
      // An absent, stale or foreign descriptor is simply not available for new turns.
    }
  }
  return hosts.length > 0 ? hosts : [primary];
}

/**
 * The browser helper is one process for every host, so it can be started from any live launcher's
 * binary. Prefer the primary, fall back to a live pool member, and when nothing is live re-read the
 * primary so its own error is what the caller sees.
 */
export function readAnyLauncherBrowserHostDescriptor<T = LauncherBrowserHostDescriptor>(
  primary: string,
  pool: readonly string[] = [],
  read: (path: string) => T = readLauncherBrowserHostDescriptor as unknown as (path: string) => T,
): T {
  for (const host of availableLauncherHosts(primary, pool, read as DescriptorReader)) {
    try {
      return read(launcherSlotDescriptor(host));
    } catch {
      // Raced with that launcher exiting; try the next one.
    }
  }
  return read(launcherSlotDescriptor(primary));
}

/**
 * Choose the launcher for a new browser turn: the conversation's own launcher when it is still
 * available, otherwise the live one with the fewest turns in flight (ties keep the primary first).
 */
/**
 * How many launchers can really take a turn right now: the live ones that are not quarantined, and
 * never fewer than one. Running three browser turns at once when only one host is signed in put
 * three tasks through a single browser, where the model picker and the connector menu then timed
 * out (Mars, 2026-09-23).
 */
export function usableLauncherHostCount(
  primary: string,
  pool: readonly string[] = [],
  read: DescriptorReader = readLauncherBrowserHostDescriptor,
): number {
  const now = Date.now();
  const live = availableLauncherHosts(primary, pool, read);
  return Math.max(1, live.filter(host => !quarantined(host, now)).length);
}

export function selectLauncherHost(options: {
  primary: string;
  pool?: readonly string[];
  activeTurns: (host: string) => number;
  conversationKey?: string;
  read?: DescriptorReader;
}): string {
  const live = availableLauncherHosts(options.primary, options.pool, options.read);
  const now = Date.now();
  const healthy = live.filter(host => !quarantined(host, now));
  // With every host quarantined, fall back to all of them rather than failing outright — but in
  // order of when each was quarantined, oldest first. Picking the least busy one instead sent every
  // turn to the hosts that fail in a second (a signed-out host is always the idlest), which is how
  // three signed-out-or-aborting hosts starved the working one on Mars.
  const hosts = healthy.length > 0
    ? healthy
    : [...live].sort((left, right) => (quarantine.get(left) ?? 0) - (quarantine.get(right) ?? 0));
  const sticky = launcherHostForConversation(options.conversationKey);
  if (sticky && hosts.includes(sticky)) return sticky;
  // Nothing healthy: the order above is the answer. Load says nothing here, because the hosts that
  // fail fastest look the idlest.
  if (healthy.length === 0) return hosts[0]!;
  let best = hosts[0]!;
  for (const host of hosts.slice(1)) {
    if (options.activeTurns(host) < options.activeTurns(best)) best = host;
  }
  return best;
}
