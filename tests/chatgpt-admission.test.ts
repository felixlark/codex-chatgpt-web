import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COOLDOWN_MS,
  PROBES_TO_REOPEN,
  ADMISSION_FLOOR,
  ADMISSION_SEED,
  ChatGptAdmission,
  isChatGptRateLimitError,
} from "../src/adapters/chatgpt-web/admission";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function harness(options: { maxConcurrent?: number; statePath?: string; start?: number } = {}) {
  let now = options.start ?? 1_000_000;
  let timer: (() => void) | undefined;
  const logs: string[] = [];
  const admission = new ChatGptAdmission({
    maxConcurrent: options.maxConcurrent ?? 3,
    statePath: options.statePath,
    now: () => now,
    log: message => logs.push(message),
    setTimer: callback => {
      timer = callback;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      timer = undefined;
    },
  });
  return {
    admission,
    logs,
    advance(ms: number) {
      now += ms;
      const fire = timer;
      timer = undefined;
      fire?.();
    },
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function admittedKeys(promises: Array<Promise<() => void>>): Promise<boolean[]> {
  const state = promises.map(() => false);
  promises.forEach((promise, index) => void promise.then(() => { state[index] = true; }));
  await settle();
  return state;
}

describe("ChatGPT account admission", () => {
  test("runs at most one turn per pool host and admits the next on release", async () => {
    const { admission } = harness({ maxConcurrent: 2 });
    const turns = [admission.acquire("a", "t1"), admission.acquire("b", "t2"), admission.acquire("c", "t3")];
    expect(await admittedKeys(turns)).toEqual([true, true, false]);
    (await turns[0]!)();
    expect(await admittedKeys(turns)).toEqual([true, true, true]);
  });

  test("holds turns once the 10-minute budget is spent and releases them as it ages out", async () => {
    const { admission, advance } = harness({ maxConcurrent: 100 });
    const releases: Array<() => void> = [];
    for (let index = 0; index < ADMISSION_SEED.req10; index += 1) {
      releases.push(await admission.acquire(`k${index}`, `t${index}`));
    }
    releases.forEach(release => release());
    const waiting = admission.acquire("late", "late");
    expect(await admittedKeys([waiting])).toEqual([false]);
    advance(10 * 60_000 + 100);
    expect(await admittedKeys([waiting])).toEqual([true]);
  });

  test("serves tasks round-robin so one busy task cannot starve another", async () => {
    const { admission } = harness({ maxConcurrent: 1 });
    const order: string[] = [];
    const first = await admission.acquire("busy", "b0");
    const queued = [
      admission.acquire("busy", "b1"), admission.acquire("busy", "b2"), admission.acquire("quiet", "q1"),
    ];
    queued.forEach((promise, index) => void promise.then(release => {
      order.push(["b1", "b2", "q1"][index]!);
      release();
    }));
    first();
    await settle(); await settle(); await settle();
    expect(order).toEqual(["b1", "q1", "b2"]);
  });

  test("a throttle cools down briefly and tightens the budget; the retry waits, it does not fail", async () => {
    const { admission, advance } = harness();
    admission.noteThrottle();
    const cut = admission.snapshot();
    expect(cut.budget.req10).toBe(Math.max(ADMISSION_FLOOR.req10, Math.floor(ADMISSION_SEED.req10 * 0.7)));
    expect(cut.cooldownUntil).toBe(1_000_000 + COOLDOWN_MS);
    const waiting = admission.acquire("a", "retry");
    expect(await admittedKeys([waiting])).toEqual([false]);
    advance(COOLDOWN_MS + 100);
    expect(await admittedKeys([waiting])).toEqual([true]);
  });

  test("after the cooldown turns go one at a time until three prompts in a row are accepted", async () => {
    const { admission, advance, logs } = harness({ maxConcurrent: 5 });
    admission.noteThrottle();
    const turns = ["p1", "p2", "p3", "x1", "x2"].map(id => admission.acquire(id, id));
    advance(COOLDOWN_MS + 100);
    expect(await admittedKeys(turns)).toEqual([true, false, false, false, false]);
    admission.noteAccepted("p1");                      // still running, but its prompt got through
    expect(await admittedKeys(turns)).toEqual([true, true, false, false, false]);
    admission.noteAccepted("p2");
    expect(await admittedKeys(turns)).toEqual([true, true, true, false, false]);
    admission.noteAccepted("p3");                      // third acceptance: fully open
    expect(await admittedKeys(turns)).toEqual([true, true, true, true, true]);
    expect(logs.some(line => line.includes("probe p3 accepted: gate open"))).toBe(true);
    expect(PROBES_TO_REOPEN).toBe(3);
  });

  test("a throttle during slow start doubles the cooldown and restarts the count", async () => {
    const { admission, advance } = harness();
    admission.noteThrottle();
    const turns = ["p1", "p2", "p3"].map(id => admission.acquire(id, id));
    advance(COOLDOWN_MS + 100);
    const releaseP1 = await turns[0]!;
    admission.noteAccepted("p1");
    const releaseP2 = await turns[1]!;
    admission.noteThrottle();                          // p2 was refused
    releaseP2("ChatGPT rate limit: too many requests");
    expect(admission.snapshot().cooldownUntil - (1_000_000 + COOLDOWN_MS + 100)).toBe(2 * COOLDOWN_MS);
    releaseP1();                                       // p1 finishing now is stale evidence
    expect(await admittedKeys([turns[2]!])).toEqual([false]);
    advance(2 * COOLDOWN_MS + 100);
    expect(await admittedKeys([turns[2]!])).toEqual([true]);
  });

  test("turns refused together are one throttle episode, not one per turn", async () => {
    const { admission } = harness();
    admission.noteThrottle();
    const first = admission.snapshot();
    admission.noteThrottle();
    admission.noteThrottle();
    const after = admission.snapshot();
    expect(after.cooldownUntil).toBe(first.cooldownUntil);   // no doubling
    expect(after.budget).toEqual(first.budget);               // no second cut
  });

  test("a probe that fails for another reason hands the probe to the next waiter", async () => {
    const { admission, advance } = harness();
    admission.noteThrottle();
    const turns = ["p1", "p2"].map(id => admission.acquire(id, id));
    advance(COOLDOWN_MS + 100);
    (await turns[0]!)("ChatGPT stopped responding");  // not a throttle: proves nothing
    expect(await admittedKeys(turns)).toEqual([true, true]);
    expect(admission.snapshot().cooldownUntil).toBe(1_000_000 + COOLDOWN_MS);   // no new cooldown
  });

  test("a probe that completes without an acceptance event still counts once", async () => {
    const { admission, advance } = harness();
    admission.noteThrottle();
    const turns = ["p1", "p2"].map(id => admission.acquire(id, id));
    advance(COOLDOWN_MS + 100);
    (await turns[0]!)();
    expect(await admittedKeys(turns)).toEqual([true, true]);
  });

  test("the 60-minute window holds turns the 10- and 30-minute windows would still admit", async () => {
    const { admission, advance } = harness({ maxConcurrent: 100 });
    for (let index = 0; index < ADMISSION_SEED.req60; index += 1) {
      (await admission.acquire(`h${index}`, `h${index}`))();
      advance(1.45 * 60_000);                                      // 20 turns in 29 minutes
    }
    const snapshot = admission.snapshot();
    expect(snapshot.recent10).toBeLessThan(ADMISSION_SEED.req10);
    expect(snapshot.recent30).toBeLessThan(snapshot.budget.req30);
    const late = admission.acquire("late", "late");
    expect(await admittedKeys([late])).toEqual([false]);
    advance(31 * 60_000 + 100);                                    // the first turn leaves the hour
    expect(await admittedKeys([late])).toEqual([true]);
  });

  test("a budget held down by the 60-minute window loosens once that window runs busy", async () => {
    const { admission, advance } = harness({ maxConcurrent: 100 });
    admission.noteThrottle();                                       // cuts every window, 60m to 14
    advance(COOLDOWN_MS + 100);
    for (const id of ["p1", "p2", "p3"]) {                          // slow start
      const release = await admission.acquire(id, id);
      admission.noteAccepted(id);
      release();
    }
    const cut = admission.snapshot().budget.req60;
    for (let index = 0; index < 6; index += 1) {                    // 9 in the hour: busy for 60m only
      (await admission.acquire(`b${index}`, `b${index}`))();
      advance(3 * 60_000);
    }
    advance(15 * 60_000);                                           // past the 30-minute adjust interval
    (await admission.acquire("next", "next"))();
    expect(admission.snapshot().budget.req60).toBeGreaterThan(cut);
  });

  test("a refunded turn does not count against the budget", async () => {
    const { admission } = harness({ maxConcurrent: 100 });
    for (let index = 0; index < 5; index += 1) (await admission.acquire(`r${index}`, `r${index}`))("page failed", true);
    (await admission.acquire("kept", "kept"))();
    expect(admission.snapshot().recent10).toBe(1);
  });

  test("a turn already running when the throttle hit is not a probe", async () => {
    const { admission, advance } = harness();
    const inFlight = await admission.acquire("a", "old");
    admission.noteThrottle();
    advance(COOLDOWN_MS + 100);
    admission.noteAccepted("old");
    inFlight();                                         // succeeds, but proves nothing
    const next = [admission.acquire("b", "p"), admission.acquire("c", "q")];
    expect(await admittedKeys(next)).toEqual([true, false]);   // still slow start: one probe
  });

  test("the budget never drops below its floor", () => {
    const { admission, advance } = harness();
    for (let index = 0; index < 20; index += 1) {
      admission.noteThrottle();
      advance(61 * 60_000);                            // past even the capped cooldown
    }
    expect(admission.snapshot().budget).toEqual(ADMISSION_FLOOR);
  });

  test("an aborted waiter leaves the queue without consuming budget", async () => {
    const { admission } = harness({ maxConcurrent: 1 });
    const holder = await admission.acquire("a", "a");
    const controller = new AbortController();
    const waiting = admission.acquire("b", "b", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("aborted");
    expect(admission.snapshot().queued).toBe(0);
    holder();
    expect(admission.snapshot().recent10).toBe(1);
  });

  test("learned budget and cooldown survive a bridge restart", () => {
    const root = mkdtempSync(join(tmpdir(), "chatgpt-admission-"));
    roots.push(root);
    const statePath = join(root, "state.json");
    harness({ statePath }).admission.noteThrottle();
    const reloaded = harness({ statePath }).admission.snapshot();
    expect(reloaded.budget.req10).toBeLessThan(ADMISSION_SEED.req10);
    expect(reloaded.cooldownUntil).toBeGreaterThan(1_000_000);
  });

  test("thirty busy minutes without a throttle loosen the budget", async () => {
    const { admission, advance } = harness({ maxConcurrent: 100 });
    const busy = Math.ceil(ADMISSION_SEED.req30 * 0.6);            // 18: at least 60% of the budget
    advance(60_000);
    for (let index = 0; index < busy / 2; index += 1) (await admission.acquire(`a${index}`, `a${index}`))();
    advance(11 * 60_000);                                          // first batch leaves the 10-minute window
    for (let index = 0; index < busy / 2; index += 1) (await admission.acquire(`b${index}`, `b${index}`))();
    expect(admission.snapshot().budget.req30).toBe(ADMISSION_SEED.req30);   // too early to loosen
    advance(18 * 60_000 + 1);                                      // 30 minutes since the last adjustment
    (await admission.acquire("next", "next"))();
    expect(admission.snapshot().budget.req30).toBeGreaterThan(ADMISSION_SEED.req30);
  });

  test("recognizes the browser's throttle message", () => {
    expect(isChatGptRateLimitError(new Error("ChatGPT rate limit: too many requests. Try again in a few minutes."))).toBe(true);
    expect(isChatGptRateLimitError(new Error("ChatGPT stopped responding"))).toBe(false);
  });

  test("the state file carries a live view of running and queued turns for status pages", async () => {
    const root = mkdtempSync(join(tmpdir(), "chatgpt-admission-"));
    roots.push(root);
    const statePath = join(root, "state.json");
    const { admission } = harness({ statePath, maxConcurrent: 1 });
    const holder = await admission.acquire("task-a", "t1");
    void admission.acquire("task-b", "t2");
    await settle();
    let live = JSON.parse(readFileSync(statePath, "utf8")).live;
    expect(live.running).toBe(1);
    expect(live.maxConcurrent).toBe(1);
    expect(live.queued.map((item: { traceId: string }) => item.traceId)).toEqual(["t2"]);
    holder();
    await settle();
    live = JSON.parse(readFileSync(statePath, "utf8")).live;
    expect(live.queued).toEqual([]);
    expect(live.running).toBe(1);                                  // t2 took the freed slot
  });
});

describe("ChatGPT account admission turn records", () => {
  test("records admitted turns with thread, model, host and outcome", async () => {
    const root = mkdtempSync(join(tmpdir(), "chatgpt-admission-"));
    roots.push(root);
    const statePath = join(root, "state.json");
    const { admission } = harness({ statePath });
    const ok = await admission.acquire("k1", "t1", undefined, { threadId: "thread-a", model: "chatgpt-web/high" });
    admission.noteHost("t1", "beta");
    ok();
    const failed = await admission.acquire("k2", "t2", undefined, { threadId: "thread-b" });
    failed("ChatGPT stopped responding");
    await admission.acquire("k3", "t3");                                    // still running at "restart"
    const recent = JSON.parse(readFileSync(statePath, "utf8")).recent;
    expect(recent.map((record: { traceId: string }) => record.traceId)).toEqual(["t1", "t2", "t3"]);
    expect(recent[0]).toMatchObject({ threadId: "thread-a", model: "chatgpt-web/high", host: "beta" });
    expect(recent[0].endedAt).toBeDefined();
    expect(recent[1].error).toBe("ChatGPT stopped responding");
  });

  test("a turn open when the bridge stopped is recorded as interrupted", async () => {
    const root = mkdtempSync(join(tmpdir(), "chatgpt-admission-"));
    roots.push(root);
    const statePath = join(root, "state.json");
    await harness({ statePath }).admission.acquire("k", "open");
    const { admission } = harness({ statePath });
    (await admission.acquire("k2", "next"))();
    const recent = JSON.parse(readFileSync(statePath, "utf8")).recent;
    expect(recent[0]).toMatchObject({ traceId: "open", error: "bridge restarted" });
  });
});

test("a slot whose turn never finishes is reclaimed, so the queue cannot sit still", async () => {
  let now = 1_000_000;
  let timer: (() => void) | undefined;
  const admission = new ChatGptAdmission({
    maxConcurrent: 1,
    now: () => now,
    log: () => {},
    setTimer: callback => { timer = callback; return 0 as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: () => {},
  });
  await admission.acquire("key-a", "trace-a");            // admitted, and never released
  const second = admission.acquire("key-b", "trace-b");
  let admitted = false;
  void second.then(() => { admitted = true; });
  await Bun.sleep(1);
  expect(admitted).toBe(false);                            // blocked behind the first slot
  now += 21 * 60_000;                                      // past the stale-slot deadline
  timer?.();                                               // the scheduled wake-up pumps again
  await Bun.sleep(1);
  expect(admitted).toBe(true);
  expect(admission.snapshot().running).toBe(1);            // only the second turn holds a slot now
});
