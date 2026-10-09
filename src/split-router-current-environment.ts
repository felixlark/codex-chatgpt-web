import { getCodexHome } from "./codex-integration-shared";
import { extractChatGptRootThreadMetadata, extractChatGptTurnIdentity, hasCurrentChatGptEnvironmentContext } from "./adapters/chatgpt-web/environment";
import { resolveCurrentCodexRolloutEnvironment } from "./adapters/chatgpt-web/codex-rollout-environment";
import type { CodexParsedRequest } from "./types";

type Row = Record<string, unknown>;
const object = (value: unknown): Row | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** Resolve an observed native calendar delta from this turn's local authority; never cached rights. */
export function prepareCurrentCalendarEnvironment(body: Row, parsed: CodexParsedRequest, codexHome = getCodexHome()): Row | undefined {
  const identity = extractChatGptTurnIdentity(parsed);
  const native = extractChatGptRootThreadMetadata(parsed);
  if (!identity.turnId || native?.sandboxType !== "dangerFullAccess" || !Array.isArray(body.input)
    || !hasCurrentChatGptEnvironmentContext(parsed)) return undefined;
  const client = object(body.client_metadata);
  const raw = client?.["x-codex-turn-metadata"];
  let metadata: Row | undefined;
  try { metadata = typeof raw === "string" ? object(JSON.parse(raw)) : object(raw); } catch { return undefined; }
  if (!metadata || [metadata.sandbox_mode, metadata.sandbox].some(value => value !== undefined
    && (typeof value !== "string" || !["none", "unrestricted", "danger-full-access"].includes(value.trim().toLowerCase().replaceAll("_", "-"))))) return undefined;
  const candidates = body.input.flatMap((value, index) => {
    const item = object(value);
    if (item?.type !== "message" || item.role !== "user") return [];
    const meta = object(item.internal_chat_message_metadata_passthrough);
    const kinds = meta?.content_item_kinds;
    const parts = Array.isArray(item.content) ? item.content : [];
    const attempted = (Array.isArray(kinds) && kinds.includes("environments.environment_context"))
      || (typeof item.content === "string" && /^<\/?environment_context\b/i.test(item.content.trimStart()))
      || parts.some(part => typeof object(part)?.text === "string" && /^<\/?environment_context\b/i.test((object(part)!.text as string).trimStart()));
    if (!attempted || (meta?.turn_id !== undefined && meta.turn_id !== identity.turnId)) return [];
    return [{ item, index, meta, parts }];
  });
  // No alternate/malformed/ambiguous current update can be hidden behind a valid fragment.
  if (candidates.length === 0) return undefined;
  const historical = candidates.slice(0, -1);
  if (historical.some(({ item, meta }) => meta?.turn_id !== undefined || typeof item.id !== "string" || !item.id)) return undefined;
  const { item, index, meta, parts } = candidates.at(-1)!;
  if (typeof item.id !== "string" || !item.id || parts.length !== 1
    || object(parts[0])?.type !== "input_text" || typeof object(parts[0])?.text !== "string"
    || (meta?.content_item_kinds !== undefined && (!Array.isArray(meta.content_item_kinds)
      || meta.content_item_kinds.length !== 1 || meta.content_item_kinds[0] !== "environments.environment_context"))) return undefined;
  const text = (object(parts[0])!.text as string).trim();
  if (!/^<environment_context>\s*<current_date>\d{4}-\d{2}-\d{2}<\/current_date>\s*<timezone>[^<>]+<\/timezone>\s*<filesystem>\s*<permission_profile type="disabled">\s*<file_system type="unrestricted"\s*\/>\s*<\/permission_profile>\s*<\/filesystem>\s*<\/environment_context>$/.test(text)) return undefined;
  const environment = resolveCurrentCodexRolloutEnvironment({
    codexHome, lineage: native, turnId: identity.turnId,
    currentEnvironmentMessage: { id: item.id, content: item.content },
    ...(historical.length ? { historicalEnvironmentMessages: historical.map(({ item }) => ({ id: item.id as string, content: item.content })) } : {}),
  });
  if (!environment || environment.sandboxPolicy.type !== "dangerFullAccess") return undefined;
  // Serialize only fields verified by the exact current native turn_context. This is not a
  // guessed cwd or a historical grant. Preserve the delta's calendar data and request contents.
  const xml = text.replace("<environment_context>", `<environment_context><cwd>${escapeXml(environment.cwd)}</cwd>`)
    .replace("<filesystem>", `<filesystem><workspace_roots>${environment.roots.map(root => `<root>${escapeXml(root)}</root>`).join("")}</workspace_roots>`);
  const input = [...body.input];
  input[index] = { ...item, content: [{ type: "input_text", text: xml }],
    internal_chat_message_metadata_passthrough: { ...meta, turn_id: identity.turnId,
      content_item_kinds: ["environments.environment_context"] } };
  return { ...body, input };
}
