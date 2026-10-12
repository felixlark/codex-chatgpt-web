import { expect, test } from "bun:test";
import { SplitEnvironmentReplay } from "../src/split-router-environment";
import { extractChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";
import { parseRequest } from "../src/responses/parser";

const xml = '<environment_context><cwd>/private/tmp</cwd><filesystem><workspace_roots><root>/private/tmp</root></workspace_roots><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry></file_system></permission_profile></filesystem></environment_context>';
function body(turn: string, input: unknown[], mode = "read-only", thread = "thread_test") {
  return { model: "gpt-6.1-sol", input, client_metadata: { "x-codex-turn-metadata": JSON.stringify({
    installation_id: "install_test", thread_id: thread, turn_id: turn, sandbox: "seatbelt", sandbox_mode: mode,
  }) } };
}
const envelope = { type: "message", id: "msg_env", role: "user", content: [{ type: "input_text", text: xml }] };
const prompt = (id: string) => ({ type: "message", id, role: "user", content: [{ type: "input_text", text: "Reply OK" }] });
const answer = { type: "message", id: "msg_answer", role: "assistant", content: [{ type: "output_text", text: "OK" }] };

test("replays the same native read-only grant when switching to Web", () => {
  const replay = new SplitEnvironmentReplay();
  const first = body("turn_a", [envelope, prompt("msg_a")]);
  expect(replay.prepare(first, false)).toBe(first);
  const second = body("turn_b", [envelope, prompt("msg_a"), answer, prompt("msg_b")]);
  const prepared = replay.prepare(second, true);
  expect(prepared).not.toBe(second);
  const env = extractChatGptTurnEnvironment(parseRequest(prepared));
  expect(env.cwd).toBe("/private/tmp"); expect(env.sandboxPolicy.type).toBe("readOnly"); expect(env.writableRoots).toEqual([]);
});

test("never infers authority from historical envelopes or crosses threads", () => {
  const replay = new SplitEnvironmentReplay();
  const historical = body("turn_b", [envelope, prompt("msg_a"), answer, prompt("msg_b")]);
  expect(replay.prepare(historical, true)).toBe(historical);
  replay.prepare(body("turn_a", [envelope, prompt("msg_a")]), false);
  const other = body("turn_c", [prompt("msg_c")], "read-only", "thread_other");
  expect(replay.prepare(other, true)).toBe(other);
});

test("changed sandbox, workspace or malformed current update cannot reuse a prior grant", () => {
  const replay = new SplitEnvironmentReplay();
  replay.prepare(body("turn_a", [envelope, prompt("msg_a")]), false);
  const changed = body("turn_b", [prompt("msg_b")], "danger-full-access");
  expect(replay.prepare(changed, true)).toBe(changed);
  const roots = body("turn_b", [prompt("msg_b")]);
  roots.client_metadata["x-codex-turn-metadata"] = JSON.stringify({ thread_id: "thread_test", installation_id: "install_test", turn_id: "turn_b", sandbox_mode: "read-only", workspaces: { "/other": {} } });
  expect(replay.prepare(roots, true)).toBe(roots);
  const invalid = body("turn_c", [{ ...envelope, content: [{ type: "input_text", text: "<environment_context><cwd>bad" }] }, prompt("msg_c")]);
  expect(replay.prepare(invalid, true)).toBe(invalid);
  const after = body("turn_d", [prompt("msg_d")]);
  expect(replay.prepare(after, true)).toBe(after);
});
