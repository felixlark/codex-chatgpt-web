import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { isChatGptSignedOutLandingPage } from "../src/chatgpt-session";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("guest landing fails with sign-in required before composer wait; hidden auth controls do not", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', route => route.fulfill({contentType:'text/html',body:`
      <button data-login-button data-mobile-auth-entry-action="login">Log in</button>
      <button data-mobile-auth-entry-point="mobile_chat_stage_header" data-mobile-auth-entry-action="signup">Sign up for free</button>
      <form><textarea id="mobile-composer-prompt" placeholder="Ask ChatGPT"></textarea></form>`}));
    await page.goto('https://chatgpt.com/?temporary-chat=true');
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const started = Date.now();
    try { await worker.activeComposer(page, 30_000); throw new Error('unexpected success'); }
    catch (error: any) {
      expect(error.code).toBe('chatgpt_sign_in_required');
      expect(error.retryable).toBe(false);
      expect(error.status).toBe(401);
    }
    expect(Date.now() - started).toBeLessThan(3_000);
    await page.locator('[data-mobile-auth-entry-action="signup"]').evaluate(node => (node as HTMLElement).hidden = true);
    expect(await isChatGptSignedOutLandingPage(page)).toBe(false);
    await page.setContent('<div id="prompt-textarea" contenteditable="true"></div>');
    expect(await (await worker.activeComposer(page, 1000)).count()).toBe(1);
  } finally { await browser.close(); }
}, 15_000);
