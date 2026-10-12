import { expect, test } from "bun:test";
import { ChatGptAdmission } from "../src/adapters/chatgpt-web/admission";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";

const tick = () => Bun.sleep(0);

test.each([6, 10, 20])("%i sessions share one five-slot queue and reconnect without a second admission", async count => {
  const admission = new ChatGptAdmission({ maxConcurrent: 5, log() {} });
  const sessions = new ChatGptTurnSessions();
  const running = new Map<number, () => void>();
  const starts: number[] = [];
  let peak = 0;
  const register = (i: number) => sessions.getOrCreateAfterOwnerRetirement(
    `key-${i}`, `owner-${i}`, () => {
      const browser = admission.acquire(`thread-${i}`, `trace-${i}`).then(async release => {
        starts.push(i);
        await new Promise<void>(resolve => {
          running.set(i, resolve);
          peak = Math.max(peak, running.size);
        });
        running.delete(i);
        // No submission in this fixture: exercise scheduling independently of budget.
        release(undefined, true);
        return "done";
      });
      return { mode: "read-only" as const, browser,
        physicalSettlement: browser.then(() => {}),
        trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(), cancel() {} };
    }, `trace-${i}`, undefined, `turn-${i}`, `thread-${i}`, undefined, true,
  );
  const registered = await Promise.all(Array.from({ length: count }, (_, i) => register(i)));
  await tick();
  expect(admission.snapshot()).toMatchObject({ running: 5, queued: count - 5 });
  // An existing owner remains reachable even when every physical slot is busy.
  expect(await register(0)).toBe(registered[0]);
  expect(await register(count - 1)).toBe(registered[count - 1]);
  expect(admission.snapshot().queued).toBe(count - 5);
  for (let i = 0; i < count; i++) {
    expect(running.has(i)).toBeTrue();
    running.get(i)!();
    await registered[i]!.physicalSettlement;
    await tick();
  }
  expect(starts).toEqual(Array.from({ length: count }, (_, i) => i));
  expect(peak).toBe(5);
  expect(admission.snapshot()).toMatchObject({ running: 0, queued: 0 });
  sessions.clear();
});

test("bounded overload and queued cancellation preserve the remaining queue", async () => {
  const admission = new ChatGptAdmission({ maxConcurrent: 1, maxQueued: 1, log() {} });
  const first = await admission.acquire("first", "first");
  const abort = new AbortController();
  const second = admission.acquire("second", "second", abort.signal);
  const cancelled = second.catch(error => error);
  await expect(admission.acquire("third", "third")).rejects.toMatchObject({ code: "chatgpt_queue_full", retryable: true });
  abort.abort();
  expect(await cancelled).toMatchObject({ name: "AbortError" });
  expect(admission.snapshot()).toMatchObject({ running: 1, queued: 0 });
  const replacement = admission.acquire("third", "third");
  first();
  (await replacement)();
  expect(admission.snapshot()).toMatchObject({ running: 0, queued: 0 });
});
