import { expect, test } from "bun:test";
import { selectChatGptModelFamily, assertChatGptModelFamily } from "../src/adapters/chatgpt-web/model-selection";
import { ChatGptBrowserWorker, ChatGptBrowserObservationTimeoutError, browserStageTimeouts } from "../src/adapters/chatgpt-web/browser-worker";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";

// No browser launch, authentication, navigation or network: synthetic locator contracts only.
function picker(label = "GPT-5.6 Sol", fault: "remount" | "attached" | "ambiguous" | "none" = "none") {
  let attached = true, selected = false, advanced = false, clicks = 0;
  const option = {
    count: async () => fault === "ambiguous" ? 2 : label === "GPT-5.6 Sol" ? 1 : 0,
    getAttribute: async () => String(selected),
    waitFor: async () => { if (label !== "GPT-5.6 Sol" || !advanced) throw Error("missing exact visible family"); },
    click: async () => { clicks++; selected = true; },
  };
  const trigger = { count: async () => 1, click: async () => {
    if (fault === "remount") attached = false;
    if (fault !== "none") throw Error("locator.click: Timeout; element detached or unstable");
    advanced = true;
  } };
  const view = { count: async () => 1, getAttribute: async () => advanced ? "advanced" : "simple", locator: () => trigger };
  const menu = { menu: {
    count: async () => attached ? 1 : 0,
    locator: () => view,
    getByRole: (_role: string, options: {name: RegExp}) => {
      expect(options.name.test("GPT-5.6 Sol")).toBe(true);
      expect(options.name.test("GPT-6 Astra")).toBe(false);
      return option;
    },
  } } as unknown as Parameters<typeof selectChatGptModelFamily>[0];
  return { menu, clicks: () => clicks };
}

test("DOT menu remount rebinds the owned picker before selecting exact 5.6", async () => {
  const old = picker("GPT-5.6 Sol", "remount"), fresh = picker();
  let activations = 0;
  expect(await selectChatGptModelFamily(old.menu, "5.6", async () => { activations++; return fresh.menu; })).toBe(fresh.menu);
  expect(activations).toBe(2); // reacquire, then verify selected family
  expect(old.clicks()).toBe(0);
  expect(fresh.clicks()).toBe(1);
});

for (const fault of ["attached", "ambiguous"] as const) test(`DOT menu ${fault} failure does not reopen or send`, async () => {
  const old = picker("GPT-5.6 Sol", fault);
  let activations = 0;
  await expect(selectChatGptModelFamily(old.menu, "5.6", async () => { activations++; return picker().menu; }))
    .rejects.toMatchObject({code: "model_version_unavailable", retryable: false});
  expect(activations).toBe(0);
  expect(old.clicks()).toBe(0);
});

test("DOT menu repeated remount remains bounded and unsent", async () => {
  const old = picker("GPT-5.6 Sol", "remount"), fresh = picker("GPT-5.6 Sol", "remount");
  let activations = 0;
  await expect(selectChatGptModelFamily(old.menu, "5.6", async () => { activations++; return fresh.menu; }))
    .rejects.toMatchObject({code: "model_version_unavailable", retryable: false});
  expect(activations).toBe(1);
  expect(old.clicks() + fresh.clicks()).toBe(0);
});

test("DOT menu remount cannot substitute a different model", async () => {
  const old = picker("GPT-5.6 Sol", "remount"), fresh = picker("GPT-6 Astra");
  await expect(selectChatGptModelFamily(old.menu, "5.6", async () => fresh.menu))
    .rejects.toMatchObject({code: "model_version_unavailable", retryable: false});
  expect(fresh.clicks()).toBe(0);
});

function sending() {
  const worker: any = Object.create(ChatGptBrowserWorker.prototype);
  const hidden = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
  const progress = new ChatGptExternalTurnProgress();
  const lifecycle: string[] = [];
  let presses = 0, recoveries = 0;
  let rejectEnter!: (error: Error) => void;
  let probe!: () => void;
  const probed = new Promise<void>(resolve => { probe = resolve; });
  const button = { count: async () => 1, isVisible: async () => true, focus: async () => {}, evaluate: async () => true, waitFor: async () => {}, isEnabled: async () => true,
    press: () => { presses++; return new Promise<void>((_resolve, reject) => { rejectEnter = reject; }); } };
  const page = { isClosed: () => false, locator: () => hidden };
  worker.activeComposer = async () => ({ locator: () => ({ locator: () => button }) });
  worker.currentSubmissionEvidence = async () => { probe(); throw new ChatGptBrowserObservationTimeoutError(5_000); };
  const send = (signal: AbortSignal) => worker.sendAttachedPrompt(page, {}, undefined, signal, progress, {
    onSendActivated: async () => { lifecycle.push("activated"); },
    onSubmitted: async () => { lifecycle.push("submitted"); },
  }, undefined, async () => {
    recoveries++;
    // Real rebind closes this transport; simulate the observed losing Enter race.
    rejectEnter(Error("Target page, context or browser has been closed"));
    return await new Promise(() => {});
  });
  return { worker, progress, lifecycle, probed, send, presses: () => presses,
    recoveries: () => recoveries, rejectEnter: () => rejectEnter(Error("late locator rejection")) };
}

test("DOT stalled pending Enter keeps transport until fresh accepted tool batch; never resends", async () => {
  const s = sending(), abort = new AbortController();
  const outcome = s.send(abort.signal).then((v: unknown) => v, (e: Error) => e);
  try {
    await s.probed;
    await Bun.sleep(10); // allow timeout recovery to enter; no real browser is involved
    expect(s.recoveries()).toBe(0);
    expect(s.lifecycle).toEqual(["activated"]);
    const revision = s.progress.recordToolBatch(1);
    expect(await outcome).toBe("mcp_tool_call");
    expect(s.lifecycle).toEqual(["activated", "submitted"]);
    expect(s.presses()).toBe(1);
    // Submission acceptance is not tool-boundary approval or task completion.
    const fence = new AbortController();
    const held = s.progress.waitForToolBatchObservation(revision, fence.signal);
    fence.abort();
    await expect(held).rejects.toThrow("aborted");
  } finally { abort.abort(); s.rejectEnter(); await outcome; }
});

test("DOT pending Enter accepts later DOM proof without rebinding or resending", async () => {
  const s = sending(), abort = new AbortController();
  s.progress.recordToolBatch(1);
  const outcome = s.send(abort.signal).then((v: unknown) => v, (e: Error) => e);
  try {
    await s.probed;
    s.worker.currentSubmissionEvidence = async () => "user_turn";
    s.progress.recordToolResult(); // wakes observation, but is not acceptance itself
    expect(await outcome).toBe("user_turn");
    expect(s.recoveries()).toBe(0);
    expect(s.presses()).toBe(1);
  } finally { abort.abort(); s.rejectEnter(); await outcome; }
});

test("DOT pending Enter remains unknown at original deadline; late progress cannot submit it", async () => {
  const s = sending();
  s.progress.recordToolBatch(1); // historical evidence predates Send
  const outcome = s.worker.runStage("dot-offline", "send", 700,
    (signal: AbortSignal) => s.send(signal)).then((v: unknown) => v, (e: Error) => e);
  await s.probed;
  s.progress.recordToolResult();
  expect(await outcome).toBeInstanceOf(Error);
  expect((await outcome as Error).message).toContain("stage timed out: send");
  s.progress.recordToolBatch(1); // too late: must not change lifecycle or re-activate Send
  await Bun.sleep(0);
  expect(s.lifecycle).toEqual(["activated"]);
  expect(s.recoveries()).toBe(0);
  expect(s.presses()).toBe(1);
  s.rejectEnter();
});


test("DOT exact 5.6/high verification still rejects wrong effort, family or missing selection", async () => {
  for (const [value, description, checked, ok] of [
    ["2", "5.6 High, 3 of 5.", true, true],
    ["1", "5.6 High, 3 of 5.", true, false],
    ["2", "6 High, 3 of 5.", true, false],
    ["2", "5.6 High, 3 of 5.", false, false],
  ] as const) {
    const menu: any = {
      menu: { getByRole: () => ({ count: async () => 1, getAttribute: async () => String(checked) }) },
      slider: {
        getAttribute: async (name: string) => name === "aria-valuemin" ? "0" : name === "aria-valuemax" ? "4" : value,
        evaluate: async () => [description],
      },
    };
    const result = assertChatGptModelFamily(menu, "5.6", "high", 2);
    if (ok) await result;
    else await expect(result).rejects.toMatchObject({ code: "model_version_unavailable", retryable: false });
  }
});

test("DOT cancellation wins over late submission proof", async () => {
  const s = sending(), abort = new AbortController();
  const outcome = s.send(abort.signal).then((v: unknown) => v, (e: Error) => e);
  await s.probed;
  abort.abort();
  s.progress.recordToolBatch(1);
  expect(await outcome).toBeInstanceOf(DOMException);
  expect(s.lifecycle).toEqual(["activated"]);
  expect(s.recoveries()).toBe(0);
  expect(s.presses()).toBe(1);
  s.rejectEnter();
});

test("DOT inline ingestion can confirm after 20 seconds without replay or tool acknowledgement", async () => {
  const s = sending();
  const outcome = s.worker.runStage("dot-inline-ingestion", "send", browserStageTimeouts.send,
    (signal: AbortSignal) => s.send(signal)).then((v: unknown) => v, (e: Error) => e);
  await s.probed;
  // Real r6 trace 825a407d1a7e delivered its first tool batch at the former
  // 20-second cutoff. Exercise the real stage deadline, with no browser/network.
  await Bun.sleep(21_000);
  const revision = s.progress.recordToolBatch(1);
  try {
    expect(await outcome).toBe("mcp_tool_call");
    expect(s.lifecycle).toEqual(["activated", "submitted"]);
    expect(s.presses()).toBe(1);
    expect(s.recoveries()).toBe(0);
    const fence = new AbortController();
    const held = s.progress.waitForToolBatchObservation(revision, fence.signal);
    fence.abort();
    await expect(held).rejects.toThrow("aborted");
  } finally { s.rejectEnter(); }
}, 30_000);

for (const scenario of ["delayed-focus", "stuck-focus", "ambiguous-target", "wrong-family"] as const) {
  test(`DOT final model check precedes focus barrier: ${scenario}`, async () => {
    const worker: any = Object.create(ChatGptBrowserWorker.prototype);
    let menuOpen = false, focused = false, focusCalls = 0, presses = 0, activations = 0;
    const order: string[] = [];
    const menu = { last() { return this; }, isVisible: async () => menuOpen };
    const hidden = { filter() { return this; }, last() { return this; }, isVisible: async () => false };
    const button = {
      count: async () => scenario === "ambiguous-target" ? 2 : 1,
      waitFor: async () => {}, isVisible: async () => true, isEnabled: async () => true,
      focus: async () => {
        focusCalls++; focused = true;
        if (focusCalls === 1 || scenario === "stuck-focus") {
          setTimeout(() => { focused = false; }, 20); // delayed menu trigger focus restoration
        }
      },
      evaluate: async (fn: (element: unknown) => boolean) => {
        const document = { activeElement: null as unknown };
        const element = { isConnected: true, tagName: "BUTTON", ownerDocument: document, matches: () => false };
        document.activeElement = focused ? element : {};
        return fn(element);
      },
      press: async () => { expect(menuOpen).toBe(false); expect(focused).toBe(true); presses++; },
    };
    const page = {
      isClosed: () => false,
      locator: (selector: string) => selector === '[role="menu"]:visible' ? menu : hidden,
      keyboard: { press: async (key: string) => { expect(key).toBe("Escape"); menuOpen = false; order.push("escape"); } },
    };
    worker.activeComposer = async () => ({ locator: () => ({ locator: () => button }) });
    worker.waitForSubmissionAcceptedWithRecovery = async () => "user_turn";
    const result = worker.sendAttachedPrompt(page, {}, undefined, undefined, undefined, {
      beforeSend: async () => {
        order.push("family-high-check"); menuOpen = true;
        if (scenario === "wrong-family") throw Error("exact family/high mismatch");
      },
      onSendActivated: async () => { order.push("activated"); activations++; },
    });
    if (scenario === "delayed-focus") {
      expect(await result).toBe("user_turn");
      expect(order).toEqual(["family-high-check", "escape", "activated"]);
      expect(focusCalls).toBe(2);
      expect(presses).toBe(1); expect(activations).toBe(1);
    } else {
      await expect(result).rejects.toThrow();
      expect(presses).toBe(0); expect(activations).toBe(0);
    }
  });
}
