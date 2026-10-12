import { afterEach, expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { ChatGptBrowserWorker, insertPlainTextIntoComposer, pastePlainTextIntoComposer, evaluateComposerEdit, runChatGptPersonalizationCleanup } from "../src/adapters/chatgpt-web/browser-worker";

test("cleanup terminates when a frozen renderer ignores its cancellation signal", async () => {
  let signal: AbortSignal | undefined;
  await expect(runChatGptPersonalizationCleanup((_deadline, cancellation) => {
    signal = cancellation;
    return new Promise(() => {});
  }, 10)).rejects.toThrow();
  expect(signal?.aborted).toBeTrue();
});

test("a nonresponsive renderer edit has a host-side deadline and is not safe to retry", async () => {
  await expect(evaluateComposerEdit(new Promise<boolean>(() => {}), undefined, 10))
    .rejects.toMatchObject({ name: "ChatGptPersistentBrowserStateError" });
});

test("aborting an in-flight edit retires its surface even if the renderer ignores abort", async () => {
  const controller = new AbortController();
  const result = evaluateComposerEdit(new Promise<boolean>(() => {}), controller.signal, 50);
  controller.abort(new Error("turn ended"));
  await expect(result).rejects.toMatchObject({ name: "ChatGptPersistentBrowserStateError" });
});

test("a settled edit retains its exact acceptance result", async () => {
  expect(await evaluateComposerEdit(Promise.resolve(true))).toBeTrue();
  expect(await evaluateComposerEdit(Promise.resolve(false))).toBeFalse();
});

/**
 * The composer insert runs inside the page, where the caret state is whatever the last UI
 * interaction left behind. Effort selection closes a menu immediately before a staged part is
 * attached, so these fixtures model the focus and selection states that actually occur there.
 */
interface FakeSelection {
  isCollapsed: boolean;
  anchorNode: object | null;
  removeAllRanges(): void;
  addRange(range: object): void;
}

const originals = { document: globalThis.document, window: globalThis.window };
test("bounded edits preserve Unicode and CRLF and stop on rejection", async () => {
  const insert = (ChatGptBrowserWorker.prototype as unknown as {
    insertPromptText(page: unknown, text: string): Promise<void>;
  }).insertPromptText;
  const text = "x".repeat(4095) + "😀" + "y".repeat(4094) + "\r\n```ts\n中\n```";
  const chunks: string[] = [];
  const worker = { activeComposer: async () => ({ focus: async () => {},
    evaluate: async (_fn: unknown, chunk: string) => { chunks.push(chunk); return true; },
  }) };
  await insert.call(worker, {}, text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk) && !chunk.endsWith("\r"))).toBeTrue();
  let edits = 0;
  await expect(insert.call({ activeComposer: async () => ({ focus: async () => {},
    evaluate: async () => { edits += 1; return false; },
  }) }, {}, text)).rejects.toThrow("rejected");
  expect(edits).toBe(1);
});

afterEach(() => {
  (globalThis as Record<string, unknown>).document = originals.document;
  (globalThis as Record<string, unknown>).window = originals.window;
});

function harness(options: {
  focusable: boolean;
  caretInsideComposer: boolean;
  collapsed?: boolean;
  execCommandResult?: boolean;
}) {
  const inside = { name: "text-node-inside-composer" };
  const composer = {
    focus() { if (options.focusable) fakeDocument.activeElement = composer; },
    contains: (node: object | null) => node === inside || node === composer,
  };
  const calls: Array<{ command: string; value: string }> = [];
  const selection: FakeSelection = {
    isCollapsed: options.collapsed ?? true,
    anchorNode: options.caretInsideComposer ? inside : { name: "node-in-the-effort-menu" },
    removeAllRanges() { selection.anchorNode = null; },
    addRange() { selection.anchorNode = inside; selection.isCollapsed = true; },
  };
  const fakeDocument = {
    activeElement: null as unknown,
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    execCommand(command: string, _ui: boolean, value: string) {
      calls.push({ command, value });
      return options.execCommandResult ?? true;
    },
  };
  (globalThis as Record<string, unknown>).document = fakeDocument;
  (globalThis as Record<string, unknown>).window = { getSelection: () => selection };
  return { composer: composer as unknown as HTMLElement, calls, selection, fakeDocument };
}

test("places the caret itself when focus has not yet produced one in the composer", () => {
  // A focusable composer may be ready before the browser has placed a caret inside it.
  const { composer, calls, selection } = harness({ focusable: true, caretInsideComposer: false });

  expect(insertPlainTextIntoComposer(composer, "staged part")).toBeTrue();
  expect(calls).toEqual([{ command: "insertText", value: "staged part" }]);
  expect(selection.isCollapsed).toBeTrue();
});

test("leaves an existing caret inside the composer exactly where it is", () => {
  const { composer, calls, selection } = harness({ focusable: true, caretInsideComposer: true });
  const anchorBefore = selection.anchorNode;

  expect(insertPlainTextIntoComposer(composer, "second part")).toBeTrue();
  expect(selection.anchorNode).toBe(anchorBefore);
  expect(calls).toEqual([{ command: "insertText", value: "second part" }]);
});

test("refuses to insert when the composer cannot take focus at all", () => {
  // A covered or detached composer must still fail rather than have text typed somewhere else.
  const { composer, calls } = harness({ focusable: false, caretInsideComposer: false });

  expect(insertPlainTextIntoComposer(composer, "staged part")).toBeFalse();
  expect(calls).toEqual([]);
});

test("reports a genuinely rejected edit as a failure", () => {
  const { composer } = harness({
    focusable: true,
    caretInsideComposer: true,
    execCommandResult: false,
  });

  expect(insertPlainTextIntoComposer(composer, "staged part")).toBeFalse();
});

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("a selected connector never appends a new request to an old draft", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
      config: { appName: "Codex Native2" },
    });
    const prompt = "Task context\n".repeat(5_000) + "\nrequest_id: current";
    for (const modern of [false, true]) {
      const pill = modern
        ? '<span app-mention-path="app://fixture" app-mention-display-name="Codex Native2" contenteditable="false">Codex Native2</span>'
        : '<span data-id="plugin:fixture" data-keyword="Codex Native2" contenteditable="false">Codex Native2</span>';
      for (const staleDraft of ["", prompt.replace("current", "earlier")]) {
        await page.setContent(`<form><div id="prompt-textarea" contenteditable="true" style="min-height:40px"></div></form>
          <div id="mention-menu" hidden><div class="__menu-item" tabindex="0" data-highlighted><span>Codex Native2</span></div></div>`);
        await page.locator("#prompt-textarea").evaluate((element, { pill, staleDraft }) => {
          element.innerHTML = pill;
          element.appendChild(document.createTextNode(staleDraft ? " " + staleDraft : ""));
          const menu = document.getElementById("mention-menu")!;
          element.addEventListener("paste", event => {
            event.preventDefault();
            const text = (event as ClipboardEvent).clipboardData!.getData("text/plain");
            const range = window.getSelection()!.getRangeAt(0);
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
          });
          element.addEventListener("input", () => { menu.hidden = element.textContent !== "@codex"; });
          element.addEventListener("keydown", event => {
            if ((event as KeyboardEvent).key !== "Enter" || menu.hidden) return;
            event.preventDefault();
            element.innerHTML = pill;
            menu.hidden = true;
          });
        }, { pill, staleDraft });
        await worker.attachPrompt(page, prompt, true);
        expect(await worker.attachedPromptText(page)).toBe(prompt);
        expect(await worker.connectorIsSelected(page.locator("#prompt-textarea"))).toBeTrue();
      }
    }
  } finally { await browser.close(); }
}, 45_000);

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("unhandled synthetic paste does not insert or claim success", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div contenteditable="true">existing</div>');
    const composer = page.locator("div");
    expect(await composer.evaluate(pastePlainTextIntoComposer, "next")).toBeFalse();
    expect(await composer.textContent()).toBe("existing");
  } finally { await browser.close(); }
});

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("composer readback excludes only ProseMirror placeholder breaks", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), { config: {} });
    for (const [html, expected] of [
      ['<p><span data-prompt-literal-paste>alpha<br>```js<br>中<br>```<br></span><br class="ProseMirror-trailingBreak"></p>', 'alpha\n```js\n中\n```\n'],
      ['<p>alpha<br><br><br class="ProseMirror-trailingBreak"></p>', 'alpha\n\n'],
      ['<p><span>alpha</span><span>beta</span></p>', 'alphabeta'],
      ['<p>alpha</p><p>beta</p>', 'alpha\nbeta'],
      ['alpha<div><br></div><div>beta</div>', 'alpha\n\nbeta'],
      ['alpha<div><br></div>', 'alpha\n'],
      ['alpha<div><br><br></div>', 'alpha\n\n\n'],
    ]) {
      await page.setContent('<div id="prompt-textarea" contenteditable="true">' + html + '</div>');
      expect(await worker.attachedPromptText(page)).toBe(expected);
    }
  } finally { await browser.close(); }
});

test("large input uses one native edit without paste or private diagnostic content", async () => {
  const insert = (ChatGptBrowserWorker.prototype as unknown as {
    insertPromptText(page: unknown, text: string): Promise<void>;
  }).insertPromptText;
  const reports: string[] = [];
  const previous = console.info;
  console.info = (line: string) => { reports.push(line); };
  try {
    await insert.call({ activeComposer: async () => ({ focus: async () => {},
      evaluate: async (fn: unknown) => { expect(fn).toBe(insertPlainTextIntoComposer); return true; },
    }) }, {}, "PRIVATE_FIXTURE".repeat(2000));
  } finally { console.info = previous; }
  expect(reports).toHaveLength(1);
  expect(reports.join("")).not.toContain("PRIVATE_FIXTURE");
  for (const line of reports) {
    const report = JSON.parse(line.slice(line.indexOf("{")));
    expect(report.phase).toBe("editing-command");
    expect(report.accepted).toBeTrue();
    expect(Object.keys(report).sort()).toEqual([
      "accepted", "chars", "elapsedMs", "newlineCount", "offset", "phase", "remainingMs", "totalChars",
    ]);
  }
});
