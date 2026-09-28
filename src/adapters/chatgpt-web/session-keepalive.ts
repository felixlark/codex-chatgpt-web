import { inspectLauncherBrowserHost } from "../../launcher-browser-host";
import { markLauncherHostBusy } from "./launcher-host-pool";

/**
 * Browser hosts lose their ChatGPT session between turns, and nothing notices until a turn fails:
 * on Mars two of three hosts were signed out for hours while goals kept being blocked. A host that
 * is only touched when a turn needs it also lets its Cloudflare clearance go stale, so the next
 * turn walks into a challenge no one is there to answer.
 *
 * So touch every idle host on a slow timer. The launcher's own inspection reloads the ChatGPT home
 * document and reports whether the session is still signed in, which both keeps the session warm
 * and turns "signed out" into something the console can show before a goal pays for it.
 */
export const KEEPALIVE_INTERVAL_MS = 20 * 60_000;
/** Long enough for a reload and the picker, short enough that a host is never held for minutes. */
export const KEEPALIVE_PROBE_TIMEOUT_MS = 60_000;

export type ChatGptKeepAliveState = "ok" | "signed-out" | "challenge" | "busy" | "error";

export interface ChatGptKeepAliveRecord {
  state: ChatGptKeepAliveState;
  at: number;
  detail?: string;
}

export interface ChatGptKeepAliveOptions {
  /** Descriptor paths of the hosts to keep warm; re-read each round so a pool change is picked up. */
  hosts: () => readonly string[];
  /** A host running a turn is warm already, and must not be disturbed. */
  busy: (host: string) => boolean;
  probe?: (host: string) => Promise<void>;
  intervalMs?: number;
  now?: () => number;
  log?: (message: string) => void;
  record?: (state: Record<string, ChatGptKeepAliveRecord>) => void;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** What a failed inspection says about the host, in the words the console shows. */
export function chatGptKeepAliveState(error: unknown): Exclude<ChatGptKeepAliveState, "ok" | "busy"> {
  const message = error instanceof Error ? error.message : String(error);
  if (/sign(ed)?[ -]?out|login is expired|not signed in|unauthenticated|auth/i.test(message)) return "signed-out";
  if (/verify|verifying|challenge|cloudflare|just a moment/i.test(message)) return "challenge";
  return "error";
}

export class ChatGptSessionKeepAlive {
  private timer?: ReturnType<typeof setTimeout>;
  private readonly results = new Map<string, ChatGptKeepAliveRecord>();
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly probe: (host: string) => Promise<void>;
  private readonly setTimer: NonNullable<ChatGptKeepAliveOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<ChatGptKeepAliveOptions["clearTimer"]>;
  private running = false;

  constructor(private readonly options: ChatGptKeepAliveOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (message => console.info(message));
    // detectCapabilities reloads the ChatGPT home document, which is what actually refreshes the
    // session and the Cloudflare clearance; a DOM-only probe would keep neither warm.
    this.probe = options.probe ?? (async host => {
      // The inspection holds the launcher's operation lock while it reloads the home document, so
      // a turn admitted onto the same host mid-check cannot reach its page (seen on Mars: two CDP
      // rebinds timed out and a goal was blocked). Count as a turn for the duration, which both
      // keeps selection away from this host and ends the check with a bounded timeout.
      const release = markLauncherHostBusy(host);
      try {
        await inspectLauncherBrowserHost(host, { detectCapabilities: true, timeoutMs: KEEPALIVE_PROBE_TIMEOUT_MS });
      } finally {
        release();
      }
    });
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer));
  }

  start(): this {
    this.schedule();
    return this;
  }

  stop(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  lastResults(): Record<string, ChatGptKeepAliveRecord> {
    return Object.fromEntries(this.results);
  }

  /** One pass over the hosts. Exposed so tests (and a future admin route) can drive it directly. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const host of this.options.hosts()) {
        if (this.options.busy(host)) {
          this.results.set(host, { state: "busy", at: this.now() });
          continue;
        }
        const before = this.results.get(host)?.state;
        try {
          await this.probe(host);
          this.results.set(host, { state: "ok", at: this.now() });
          if (before && before !== "ok" && before !== "busy") {
            this.log(`[chatgpt-web] keepalive ${name(host)} is signed in again`);
          }
        } catch (error) {
          const state = chatGptKeepAliveState(error);
          const detail = (error instanceof Error ? error.message : String(error)).slice(0, 200);
          this.results.set(host, { state, at: this.now(), detail });
          // Say it once per transition: a host stays signed out until a person logs it back in.
          if (before !== state) this.log(`[chatgpt-web] keepalive ${name(host)} ${state}: ${detail}`);
        }
      }
      this.options.record?.(this.lastResults());
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { void this.runOnce(); },
      this.options.intervalMs ?? KEEPALIVE_INTERVAL_MS);
  }
}

/** Hosts are descriptor paths; the instance name inside is what a person recognises. */
function name(host: string): string {
  return host.match(/cwg-([A-Za-z0-9_-]+)\//)?.[1] ?? host;
}
