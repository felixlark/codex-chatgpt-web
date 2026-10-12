import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { synchronizeModelCatalog } from "../src/model-catalog-sync";

const [gateway, binary, output] = process.argv.slice(2);
if (!gateway || !binary || !output) throw Error("Usage: bun scripts/sync-codex-model-catalog.ts GATEWAY_URL CODEX_BINARY OUTPUT_JSON");
const url = new URL(gateway);
if (url.username || url.password || url.search || url.hash
  || !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) throw Error("Gateway must use HTTPS or loopback and contain no credentials");
const response = await fetch(new URL("/healthz", url), { signal: AbortSignal.timeout(15_000), redirect: "error" });
if (!response.ok) throw Error(`Gateway metadata HTTP ${response.status}`);
if (!response.body) throw Error("Gateway metadata has no body");
const reader = response.body.getReader();
const chunks: Uint8Array[] = []; let size = 0;
while (true) {
  const chunk = await reader.read(); if (chunk.done) break;
  size += chunk.value.byteLength;
  if (size > 256_000) { await reader.cancel(); throw Error("Gateway metadata exceeds size bound"); }
  chunks.push(chunk.value);
}
const text = Buffer.concat(chunks).toString("utf8");
const health = JSON.parse(text);
if (health.status !== "ok" || health.service !== "codex-chatgpt-web") throw Error("Unexpected Gateway identity");
const native = spawnSync(resolve(binary), ["debug", "models", "--bundled"], { encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
if (native.status !== 0) throw Error("Official Codex bundled catalog read failed");
const catalog = synchronizeModelCatalog(JSON.parse(native.stdout), health.web_model_catalog);
const encoded = JSON.stringify(catalog, null, 2) + "\n";
// Preserve transitional output symlinks when atomically updating the catalog.
const path = existsSync(output) ? realpathSync(output) : resolve(output);
let changed = true;
try { changed = readFileSync(path, "utf8") !== encoded; } catch {}
if (changed) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, encoded, { mode: 0o600 }); renameSync(temporary, path);
}
const rows = catalog.models as Array<{ slug: string; visibility: string }>;
console.log(JSON.stringify({ changed, path, sha256: createHash("sha256").update(encoded).digest("hex"),
  gatewayVersion: health.version, upstreamCommit: health.upstream_commit,
  nativeCount: rows.filter(row => !row.slug.startsWith("chatgpt-web/")).length,
  ccwModelCount: rows.filter(row => row.slug.startsWith("chatgpt-web/") && row.visibility === "list").length }));
