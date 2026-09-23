import { expect, test } from "bun:test";
import { chatGptAnsweredWithoutTools } from "../src/adapters/chatgpt-web/toolless-turn";

test("a turn that says it had no local tools is recognised, in either language", () => {
  // Real answers from the iOS and crowd-verse goal threads on 2026-09-22/23.
  expect(chatGptAnsweredWithoutTools(
    "当前上下文仍没有提供本地 Codex Native 工具访问能力，因此无法访问真实 smart-shadow 工作区")).toBe(true);
  expect(chatGptAnsweredWithoutTools(
    "调用本地 Codex harness 时返回：`turn token is invalid, expired, or revoked`")).toBe(true);
  expect(chatGptAnsweredWithoutTools(
    "当前 Codex 本地执行通道拒绝执行该设备查询（工具侧安全状态无法确认）")).toBe(true);
  expect(chatGptAnsweredWithoutTools(
    "This session has no local Codex tools, so the workspace cannot be read")).toBe(true);
});

test("ordinary answers are left alone", () => {
  expect(chatGptAnsweredWithoutTools("已完成本轮：修改了 3 个文件并跑通测试。")).toBe(false);
  expect(chatGptAnsweredWithoutTools("The build passed and I committed the fix.")).toBe(false);
  expect(chatGptAnsweredWithoutTools("本地 Codex 工具运行正常，已执行 npm test。")).toBe(false);
});

test("a connector dropped before Send is a pre-submission failure, so the turn is refunded", async () => {
  const worker = await Bun.file("src/adapters/chatgpt-web/browser-worker.ts").text();
  expect(worker).toContain("dropped the connector before the prompt was sent");
  // The check must sit before Send is activated, or the turn could not be run again.
  const check = worker.indexOf("dropped the connector before the prompt was sent");
  const sendActivated = worker.indexOf("submissionLifecycle?.onSendActivated?.()");
  expect(check).toBeLessThan(sendActivated);
  const client = await Bun.file("src/adapters/chatgpt-web/launcher-helper-client.ts").text();
  expect(client).toContain("dropped the connector before the prompt was sent");
});
