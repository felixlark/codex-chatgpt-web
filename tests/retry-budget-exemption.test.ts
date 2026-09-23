import { expect, test } from "bun:test";
import { ChatGptWebTurnRetryPolicy, chatGptWebFailureSpendsRetryBudget } from "../src/adapters/chatgpt-web/retry-policy";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";

const failure = (message: string) => new ChatGptWebAdapterError(message, {
  status: 502, errorType: "server_error", code: "chatgpt_submitted_turn_failed", retryable: true,
});

test("a Codex-side disconnect does not spend the browser retry budget", () => {
  expect(chatGptWebFailureSpendsRetryBudget({
    message: "ChatGPT stopped responding after the task started. Codex Native retired the turn binding before its tool work completed",
  })).toBe(false);
  expect(chatGptWebFailureSpendsRetryBudget({
    message: "ChatGPT could not observe Codex Native turn retirement",
  })).toBe(false);
  expect(chatGptWebFailureSpendsRetryBudget({ message: "ChatGPT stopped responding after the task started." })).toBe(true);
});

test("four browser failures still exhaust the budget", () => {
  const policy = new ChatGptWebTurnRetryPolicy();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    expect(policy.recordRetryableFailure("k", failure("browser died")).retryable).toBe(true);
  }
  expect(policy.recordRetryableFailure("k", failure("browser died")).retryable).toBe(false);
});
