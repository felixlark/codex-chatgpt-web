import { expect, test } from "bun:test";
import { chatGptEnvironmentEnvelopeDiagnostics } from "../src/adapters/chatgpt-web/thread-environment";

function request(input: unknown[]): any {
  return { context: { messages: [], tools: [] }, _rawBody: { input,
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "synthetic-thread", turn_id: "synthetic-turn" }) },
  } };
}
function envelope(text: string, metadata: unknown = undefined): any {
  return { type: "message", role: "user", id: "private-item-id",
    content: [{ type: "input_text", text }], internal_chat_message_metadata_passthrough: metadata };
}

test("DOT cwd diagnostics distinguishes full envelope from truncated tags without leaking values", () => {
  const d = chatGptEnvironmentEnvelopeDiagnostics(request([
    envelope('<environment_context><cwd>/private/SECRET</cwd></environment_context>',
      { turn_id: "synthetic-turn", content_item_kinds: ["environments.environment_context"] }),
    envelope('<environment_context><cwd>/private/SECRET'),
  ]));
  expect(d.envelopes[0]).toMatchObject({ pureEnvelope: true, nativeEnvironmentKind: true,
    nativeTurnRelation: "current", cwdOpenCount: 1, cwdCloseCount: 1 });
  expect(d.envelopes[1]).toMatchObject({ pureEnvelope: false, nativeTurnRelation: "missing",
    envelopeCloseCount: 0, cwdOpenCount: 1, cwdCloseCount: 0 });
  expect(JSON.stringify(d)).not.toMatch(/SECRET|private-item-id|synthetic-turn/);
});

test("DOT cwd diagnostics identifies cwd-less roots and multi-environment shapes", () => {
  const d = chatGptEnvironmentEnvelopeDiagnostics(request([
    envelope('<environment_context><workspace_roots><root>/private/A</root></workspace_roots></environment_context>'),
    envelope('<environment_context><environments><environment primary="true"><cwd>/private/B</cwd></environment></environments></environment_context>'),
  ]));
  expect(d.envelopes[0]).toMatchObject({ pureEnvelope: true, cwdOpenCount: 0, rootPairCount: 1 });
  expect(d.envelopes[1]).toMatchObject({ pureEnvelope: true, cwdOpenCount: 1, environmentBlockCount: 1 });
});

test("DOT cwd diagnostics excludes tool/assistant XML and bounds native envelope records", () => {
  const input = Array.from({ length: 12 }, () => envelope('<environment_context>opaque</environment_context>'));
  input.push({ ...envelope('<environment_context>assistant-secret</environment_context>'), role: "assistant" });
  input.push({ type: "function_call_output", output: "<environment_context>tool-secret</environment_context>" });
  const d = chatGptEnvironmentEnvelopeDiagnostics(request(input));
  expect(d.envelopes.map(e => e.index)).toEqual([8, 9, 10, 11]);
  expect(JSON.stringify(d)).not.toMatch(/secret|opaque/);
});

test("DOT cwd diagnostics preserves malformed typed native fragment evidence without accepting it", () => {
  const parsed = request([envelope('broken NATIVE-SECRET', { content_item_kinds: ['environments.environment_context'] })]);
  const before = JSON.stringify(parsed);
  const d = chatGptEnvironmentEnvelopeDiagnostics(parsed);
  expect(d.envelopes[0]).toMatchObject({ nativeEnvironmentKind: true, pureEnvelope: false, cwdOpenCount: 0 });
  expect(JSON.stringify(d)).not.toContain('NATIVE-SECRET');
  expect(JSON.stringify(parsed)).toBe(before);
});
