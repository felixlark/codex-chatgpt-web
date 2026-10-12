import { expect, test } from "bun:test";
import { ChatGptSessionKeepAlive, chatGptKeepAliveState } from "../src/adapters/chatgpt-web/session-keepalive";

const hosts = ["/home/x/.local/share/cwg-alpha/core/runtime/launcher-browser.json",
               "/home/x/.local/share/cwg-beta/core/runtime/launcher-browser.json"];

function fixture(probe: (host: string) => Promise<void>, busy: (host: string) => boolean = () => false) {
  const logs: string[] = [];
  let recorded: Record<string, { state: string }> = {};
  const keepAlive = new ChatGptSessionKeepAlive({
    hosts: () => hosts,
    busy,
    probe,
    now: () => 1_000,
    log: message => logs.push(message),
    record: results => { recorded = results; },
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,   // tests drive runOnce themselves
    clearTimer: () => {},
  });
  return { keepAlive, logs, results: () => recorded };
}

test("a signed-out host is named once, not on every round", async () => {
  const probe = async (host: string) => {
    if (host.includes("alpha")) throw new Error("ChatGPT web login is expired or the Temporary Chat surface is unavailable");
  };
  const { keepAlive, logs, results } = fixture(probe);
  await keepAlive.runOnce();
  await keepAlive.runOnce();
  expect(results()[hosts[0]!]!.state).toBe("signed-out");
  expect(results()[hosts[1]!]!.state).toBe("ok");
  expect(logs.filter(line => line.includes("signed-out"))).toHaveLength(1);
  expect(logs[0]).toContain("alpha");                       // the instance name, not the path
});

test("a host that comes back is announced, and a busy host is left alone", async () => {
  let signedOut = true;
  const probe = async (host: string) => {
    if (host.includes("alpha") && signedOut) throw new Error("not signed in");
  };
  const probed: string[] = [];
  const { keepAlive, logs, results } = fixture(
    async host => { probed.push(host); await probe(host); },
    host => host.includes("beta"),
  );
  await keepAlive.runOnce();
  signedOut = false;
  await keepAlive.runOnce();
  expect(probed.every(host => host.includes("alpha"))).toBe(true);   // beta was busy with a turn
  expect(results()[hosts[1]!]!.state).toBe("busy");
  expect(logs.some(line => line.includes("signed in again"))).toBe(true);
});

test("failures are classified the way the console shows them", () => {
  expect(chatGptKeepAliveState(new Error("ChatGPT web login is expired"))).toBe("signed-out");
  expect(chatGptKeepAliveState(new Error("Just a moment... Cloudflare verifying"))).toBe("challenge");
  expect(chatGptKeepAliveState(new Error("connect ECONNREFUSED"))).toBe("error");
});

test("the real probe holds the host so no turn is admitted onto it mid-check", async () => {
  const { launcherHostHasTurn, clearLauncherHostActivity } = await import("../src/adapters/chatgpt-web/launcher-host-activity");
  const { markLauncherHostBusy } = await import("../src/adapters/chatgpt-web/launcher-host-activity");
  clearLauncherHostActivity();
  const host = hosts[0]!;
  expect(launcherHostHasTurn(host)).toBe(false);
  const release = markLauncherHostBusy(host);          // what the default probe does around itself
  expect(launcherHostHasTurn(host)).toBe(true);
  release();
  expect(launcherHostHasTurn(host)).toBe(false);
  const source = await Bun.file("src/adapters/chatgpt-web/session-keepalive.ts").text();
  expect(source).toContain("markLauncherHostBusy(host)");
  expect(source).toContain("timeoutMs: KEEPALIVE_PROBE_TIMEOUT_MS");
});
