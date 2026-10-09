import { randomUUID } from "node:crypto";
import { extractChatGptTurnEnvironment, hasCurrentChatGptEnvironmentContext } from "./adapters/chatgpt-web/environment";
import { parseRequest } from "./responses/parser";

import { prepareCurrentCalendarEnvironment } from "./split-router-current-environment";

type Row = Record<string, unknown>;
const object = (value: unknown): Row | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;

/** Carries only an already-authenticated native envelope across a model switch, in memory. */
export class SplitEnvironmentReplay {
  constructor(private readonly codexHome?: string) {}

  private snapshots = new Map<string, { xml: string; mode: string; roots: string[] }>();

  private metadata(body: Row): Row | undefined {
    const raw = object(body.client_metadata)?.["x-codex-turn-metadata"];
    try { return typeof raw === "string" ? object(JSON.parse(raw)) : object(raw); } catch { return undefined; }
  }

  prepare(value: unknown, replay: boolean): unknown {
    const body = object(value);
    if (!body || !Array.isArray(body.input)) return value;
    const metadata = this.metadata(body);
    if (!metadata || typeof metadata.thread_id !== "string" || typeof metadata.turn_id !== "string") return value;
    const key = `${metadata.installation_id ?? ""}:${metadata.thread_id}`;
    const mode = metadata.sandbox_mode ?? metadata.sandbox;
    if (typeof mode !== "string") return value;
    let parsed;
    try { parsed = parseRequest(body); } catch { return value; }

    if (replay && hasCurrentChatGptEnvironmentContext(parsed)) {
      // A calendar-only update has no cwd on the wire. The Codex-host router can prove
      // its exact item and latest turn_context; Mars cannot read the client's native rollout.
      this.snapshots.delete(key);
      try {
        const prepared = prepareCurrentCalendarEnvironment(body, parsed, this.codexHome);
        if (prepared) return prepared;
      } catch { /* Fail closed; send the original claim for the bridge to reject. */ }
    }
    if (hasCurrentChatGptEnvironmentContext(parsed)) {
      // An invalid or ambiguous current update revokes the replay, never falls back to old rights.
      this.snapshots.delete(key);
      try {
        const environment = extractChatGptTurnEnvironment(parsed);
        const fragments = body.input.flatMap(item => {
          const message = object(item);
          if (message?.type !== "message" || message.role !== "user") return [];
          const owner = object(message.internal_chat_message_metadata_passthrough)?.turn_id;
          if (owner !== undefined && owner !== metadata.turn_id) return [];
          const content = typeof message.content === "string" ? [{ text: message.content }] : message.content;
          if (!Array.isArray(content)) return [];
          return content.map(part => object(part)?.text).filter((text): text is string => (
            typeof text === "string" && /^<environment_context>[\s\S]*<\/environment_context>$/.test(text.trim())
          ));
        });
        if (fragments.length === 1) {
          this.snapshots.set(key, { xml: fragments[0]!, mode, roots: environment.roots });
          while (this.snapshots.size > 256) this.snapshots.delete(this.snapshots.keys().next().value!);
        }
      } catch { /* Invalid current native authority must be rejected by Mars, not repaired here. */ }
      return value;
    }
    const snapshot = this.snapshots.get(key);
    if (!replay || !snapshot || snapshot.mode !== mode) return value;
    const roots = object(metadata.workspaces);
    if (roots && (Object.keys(roots).length !== snapshot.roots.length
      || Object.keys(roots).some(root => !snapshot.roots.includes(root)))) return value;
    const activeIndex = body.input.findLastIndex(item => {
      const message = object(item);
      return message?.type === "message" && message.role === "user";
    });
    if (activeIndex < 0) return value;
    // The initial envelope was observed locally on this thread's real native request. Restate
    // that exact grant for Mars, which never saw the native turn; do not infer paths or privileges.
    const input = [...body.input];
    input.splice(activeIndex, 0, {
      type: "message", id: `msg_${randomUUID().replaceAll("-", "")}`, role: "user",
      content: [{ type: "input_text", text: snapshot.xml }],
      internal_chat_message_metadata_passthrough: {
        turn_id: metadata.turn_id, content_item_kinds: ["environments.environment_context"],
      },
    });
    return { ...body, input };
  }
}
