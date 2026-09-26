import { expect, test } from "bun:test";
import { CHATGPT_SIGNED_OUT_MESSAGE, isChatGptLoginPageUrl } from "../src/adapters/chatgpt-web/browser-worker";
import { chatGptKeepAliveState } from "../src/adapters/chatgpt-web/session-keepalive";

test("the login page a signed-out session is redirected to is recognised", () => {
  // Mars, 2026-09-26: every turn's navigation aborted on this redirect for nine hours.
  expect(isChatGptLoginPageUrl("https://chatgpt.com/auth/login?next=%2F%3Ftemporary-chat%3Dtrue")).toBe(true);
  expect(isChatGptLoginPageUrl("https://auth.openai.com/log-in")).toBe(true);
  expect(isChatGptLoginPageUrl("https://chatgpt.com/?temporary-chat=true")).toBe(false);
  expect(isChatGptLoginPageUrl("https://chatgpt.com/api/auth/session")).toBe(false);
  expect(isChatGptLoginPageUrl("about:blank")).toBe(false);
});

test("the keep-alive reports the launcher's signed-out answer as signed out", () => {
  expect(chatGptKeepAliveState(new Error(`Launcher ChatGPT session could not be verified: ${CHATGPT_SIGNED_OUT_MESSAGE}`)))
    .toBe("signed-out");
});
