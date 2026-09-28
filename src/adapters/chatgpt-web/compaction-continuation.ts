import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../../config";
import { decodeCompactionSummary, isReadableCompactionSummaryText, SUMMARY_PREFIX } from "../../responses/compaction";
import type { CodexParsedRequest } from "../../types";
import type { ChatGptTurnIdentity, ChatGptTurnUserRevision } from "./environment";

interface CompletedCheckpoint {
  summaryHash: string;
  sourceHashes: ReadonlySet<string>;
  source: ChatGptTurnUserRevision;
}

// Evidence of a checkpoint actually returned by this daemon, not authority inferred from text
// that happens to look like a summary. A new process must not invent a missing handoff.
const checkpoints = new Map<string, CompletedCheckpoint>();
const MAX_CHECKPOINTS = 256;

// Fork: the registry is also kept on disk. It still holds only checkpoints this daemon returned,
// but a bridge restart no longer forgets them, so a compacted thread keeps its authenticated
// environment instead of failing every later turn with "missing cwd". Tests stay in memory unless
// they point it at a file.
let checkpointPath: string | undefined | null = null;
let loaded = false;

function persistedPath(): string | undefined {
  if (checkpointPath !== null) return checkpointPath;
  return process.env.NODE_ENV === "test" ? undefined : join(getConfigDir(), "runtime", "compaction-checkpoints.json");
}

function loadCheckpoints(): void {
  if (loaded) return;
  loaded = true;
  const path = persistedPath();
  if (!path) return;
  try {
    const stored = JSON.parse(readFileSync(path, "utf8")) as Array<[string, { summaryHash: string; sourceHashes: string[]; source: ChatGptTurnUserRevision }]>;
    for (const [key, value] of stored.slice(-MAX_CHECKPOINTS)) {
      if (typeof key !== "string" || typeof value?.summaryHash !== "string" || !Array.isArray(value.sourceHashes) || !value.source) continue;
      checkpoints.set(key, { summaryHash: value.summaryHash, sourceHashes: new Set(value.sourceHashes), source: value.source });
    }
  } catch { /* none yet, or unreadable: start empty as before */ }
}

function saveCheckpoints(): void {
  const path = persistedPath();
  if (!path) return;
  const stored = [...checkpoints].map(([key, value]) => [key, {
    summaryHash: value.summaryHash, sourceHashes: [...value.sourceHashes], source: value.source,
  }]);
  try { atomicWriteFile(path, JSON.stringify(stored)); } catch { /* the memory copy still serves this process */ }
}

/** Test hook: persist to `path` (or nowhere), and forget what this process holds, like a restart. */
export function resetCompactionCheckpointsForTests(path?: string): void {
  checkpoints.clear();
  checkpointPath = path;
  loaded = false;
}

function scope(parsed: CodexParsedRequest, identity: ChatGptTurnIdentity): string | undefined {
  if (!identity.threadId || !identity.turnId) return undefined;
  return JSON.stringify([identity.threadId, identity.turnId, parsed.modelId, parsed.options.reasoning]);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceDigest(source: ChatGptTurnUserRevision): string {
  return digest([source.turnId, source.content]);
}

export function rememberCompactionContinuation(
  parsed: CodexParsedRequest,
  identity: ChatGptTurnIdentity,
  sources: readonly ChatGptTurnUserRevision[],
  summary: string,
): void {
  const key = scope(parsed, identity);
  if (!key || !parsed._compactionRequest || !summary || !sources[0]) return;
  loadCheckpoints();
  checkpoints.delete(key);
  checkpoints.set(key, {
    summaryHash: digest(summary), sourceHashes: new Set(sources.map(sourceDigest)),
    source: structuredClone(sources[0]),
  });
  while (checkpoints.size > MAX_CHECKPOINTS) checkpoints.delete(checkpoints.keys().next().value!);
  saveCheckpoints();
}

export function isAcceptedCompactionContinuation(
  parsed: CodexParsedRequest,
  identity: ChatGptTurnIdentity,
  source: ChatGptTurnUserRevision,
): boolean {
  return acceptedCheckpoint(parsed, identity)?.checkpoint.sourceHashes.has(sourceDigest(source)) === true;
}

/** Native compaction may retain only its summary; recover the task solely from our completed handoff. */
export function recoverCompactionInstruction(
  parsed: CodexParsedRequest,
  identity: ChatGptTurnIdentity,
): { source: ChatGptTurnUserRevision; summaryIndex: number } | undefined {
  const accepted = acceptedCheckpoint(parsed, identity);
  return accepted ? { source: structuredClone(accepted.checkpoint.source), summaryIndex: accepted.summaryIndex } : undefined;
}

function acceptedCheckpoint(
  parsed: CodexParsedRequest,
  identity: ChatGptTurnIdentity,
): { checkpoint: CompletedCheckpoint; summaryIndex: number } | undefined {
  const key = scope(parsed, identity);
  loadCheckpoints();
  const checkpoint = key ? checkpoints.get(key) : undefined;
  if (!key || !checkpoint) return undefined;
  const input = (parsed._rawBody as { input?: unknown[] } | undefined)?.input;
  if (!Array.isArray(input)) return undefined;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    let summary: string | null;
    if (["compaction", "compaction_summary", "context_compaction"].includes(String(item.type))) {
      summary = typeof item.encrypted_content === "string" ? decodeCompactionSummary(item.encrypted_content) : null;
    } else {
      if (item.type !== "message" || item.role !== "user") continue;
      const text = typeof item.content === "string" ? item.content : Array.isArray(item.content)
        ? item.content.map(part => part?.text ?? "").join("\n") : "";
      if (!isReadableCompactionSummaryText(text)) continue;
      summary = text.slice(SUMMARY_PREFIX.length + 1);
    }
    const owner = (item.internal_chat_message_metadata_passthrough as { turn_id?: unknown } | undefined)?.turn_id;
    if (owner !== undefined && owner !== identity.turnId) return undefined;
    return summary !== null && acceptsSummary(key, checkpoint, summary) ? { checkpoint, summaryIndex: index } : undefined;
  }
  return undefined;
}

function acceptsSummary(key: string, checkpoint: CompletedCheckpoint, summary: string): boolean {
  if (digest(summary) !== checkpoint.summaryHash) return false;
  // A long-running continuation does not become invalid merely because time passed. Keep the
  // bounded registry ordered by actual use instead of expiring a still-active native turn.
  checkpoints.delete(key);
  checkpoints.set(key, checkpoint);
  return true;
}
