# CCW upstream and Codex model catalog maintenance

Scope: CCW bridge/Gateway, browser selector compatibility, and the catalog consumed
by Codex. Preserve each existing task's explicit `chatgpt-web/*` model and effort.
Do not expand this monitor into business quality audits or resume paused owners.

## Model selection policy

New CCW engineering work uses `chatgpt-web/gpt-5.6-sol / medium` by default.
Use the same model at `high` for complex debugging, architecture, or security
review. Existing owners retain their explicit model and effort. Keep Pro
available for a bounded difficult task only when its measured quality gain
justifies additional latency; it is not the default for continuous execution.
CCW maintenance stays on official `gpt-6.1-sol / medium`.

The managed catalog defaults only the 5.6 Sol row to Medium. Do not rewrite
native descriptions, remove Pro, change account capabilities, or infer a
per-task model change from the catalog update. Desktop loads this catalog at
startup; do not interrupt active owners to refresh it. Before starting future
CCW work, explicitly select 5.6 Sol and Medium and verify its actual route.

## Sources of truth

- Verify upstream release **and commit** against the official repository. A stale
  local `upstream/main` is not a downgrade authority.
- Verify installed Gateway `/healthz` version, upstream commit, runtime bundle,
  browser helper, and tunnel MCP child. An HTTP 200 alone is insufficient.
- `/healthz.web_model_catalog` schema 1 contains only catalog capabilities and
  `slug/display_name/description/visibility/efforts`. It includes account gates,
  interaction mode, Zero Risk Pro capability, and subagent protocol; no secrets.
- Take native model metadata from the selected official Codex binary's
  `debug models --bundled`. Preserve native descriptions. Generate CCW rows from
  the exact installed runtime contract; do not infer a ChatGPT Web model from a
  similarly named newly released native Codex model.

## Managed synchronization

Run `bun scripts/sync-codex-model-catalog.ts GATEWAY_URL CODEX_BINARY OUTPUT_JSON`.
Pass the actual executable, not its enclosing package directory. For the current
ChatGPT desktop package, this is
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`.
After a desktop update, use the official `app-server daemon version` command to
compare the CLI and managed daemon. A daemon package update requires an empty
official `thread/loaded/list`; active work in other processes is not permission
to restart their router or gateway. Do not inherit a chat's temporary
`CODEX_APP_TOOLS_PIPE_PATH` into a long-lived daemon update. Desktop GUI tools
remain attached to their original desktop owner; an independently managed
daemon is not a replacement GUI executor.
Gateway metadata is bounded to 256 KB, HTTPS or loopback only, with a 15-second
fetch timeout. Invalid identity, schema, capabilities, or mismatched model contract
fails without replacing the last valid catalog. The output is an atomic, mode-0600
JSON file outside Documents; the operation preserves model and permission settings.

Configure only `model_catalog_json` through official `config/batchWrite`, then
read `config/read` and `model/list` from an official process using the saved config.
The official [configuration reference](https://developers.openai.com/codex/config-reference/)
states this setting is loaded **on startup**. A successful write or CLI catalog
read does not prove that an already running desktop selector has refreshed.
Do not restart active task owners to manufacture this proof.

## Existing monitoring, not another supervisor

Use the existing deterministic Gateway collector and existing Goal-recovery
schedule. Check upstream release/commit, installed Codex version and bundled
catalog digest, installed runtime descriptor digest, local router, and Gateway.
Synchronize on version/digest change; unchanged healthy checks remain quiet.
A new fault identity bypasses an older fault's backoff. Missing selector evidence
is an observation gap, not evidence that CCW has been retired.

With `model_catalog_json` configured, an official `model/list` or `debug models`
read may use the managed file without sending a Gateway catalog request. The age
of `last_successful_model_catalog_request_at` then measures missing recent network
observation, not the age or validity of the managed model descriptions. Keep that
transport evidence gap distinct from valid installed descriptor and native
bundled digests. Do not force an anonymous request, alter the active provider, or
rewrite an unchanged catalog merely to reset its timestamp. Synchronize only when
the verified native or exact installed Gateway contract changes; keep actual
generation and desktop selector acceptance as separate evidence.

Keep separate evidence for: valid Gateway catalog, generated catalog descriptions,
official Codex `model/list` CCW entries and efforts, and visible desktop selector.
Bind desktop proof to Gateway/upstream/installed-Codex versions and catalog digests.
Never fill `selectorVisible=true` from a network/CLI test. If official Computer Use
rejects the desktop surface, complete independent work and request only the
remaining visible check; do not bypass the rejection with private APIs/databases.

## Safe release and recovery

Reproduce the exact installed baseline bundle before applying a scoped patch.
Drain new requests, let existing HTTP/browser/admission work settle naturally,
and switch bridge, launcher helper, and tunnel MCP paths in one rollback-capable
operation. Catalog fetching remains tracked until the finite JSON catalog is produced; its
materialized body then uses Bun native delivery, avoiding a stranded SSE-wrapper
owner when a metadata client disconnects. Responses/compaction streams retain
normal ownership through completion. Age alone never authorizes cancellation.
Restore admission on any failed gate.

For an interrupted CCW task, first repair the transport/selector, read its live
original owner through official tools, and distinguish active, paused, replaced,
and terminal failures. Context exhaustion may require official same-thread
`thread/compact/start`; do not create replacement chats or clear user history.
Resume once with its confirmed CCW model/effort and read the first completed
business tool. Authentication or device-offline dependencies remain scoped to
those branches. A scheduled configuration, queued notification, or ACK alone
never establishes recovery.
