# CCW deployment practices and retirement record (felixlark fork)

Status: **retired 2026-10-12**. Codex on sol now talks to the official OpenAI
provider (`model_provider = "openai"`, `gpt-6.1-sol`). This fork is kept as the
only record of the code, deployment units and operating lessons. Nothing here is
running any more.

## 1. Deployment architecture (as it ran, Sep–Oct 2026)

```
Codex (sol, macOS)
  └─ split-router  127.0.0.1:17843  (launchd ai.bozhi.codex-split-router, src/split-router.ts)
       ├─ native Codex models  ──► OpenAI official (passthrough, no cookies/forwarded headers)
       └─ chatgpt-web/* models ──► https://mars.tailbbe133.ts.net:17841
                                    (tailscale serve --tls-terminated-tcp, tailnet only)
                                    └─► Mars 127.0.0.1:17841  cwg-bridge (bun, cli.js serve)
                                          └─ cwg-app@alpha  (Electron launcher / Chromium host,
                                             on Xvfb :99 + openbox; VNC/noVNC :6080 for logins)
                                          └─ cwg-tunnel@alpha (OpenAI tunnel-client for MCP)
```

* Mars (Ubuntu) units are in `deploy/mars/systemd/`. `cwg-*@alpha` is a single
  browser host instance; `95-ccw-mars-release.conf` drop-ins pin the release
  directory (`~/.local/lib/ccw-mars/<version>-mars.1-rN-<topic>`, unpacked AppImage).
  Last deployed release: `6.1.5-mars.1-r3-send-rebind` (6.1.6 r1/r2 staged, see
  `docs/mars-upstream-integration.md`).
* `codex-web-gpt*.service` are the older (Sep 17) single-service layout, superseded
  by `cwg-*` on Sep 19 and left disabled.
* `mars-console.service` (port 17900, `chatgpt.crowdverse.ai`) was a status page for
  the bridge, browser and connector slots only.
* sol entry points (profiles, wrapper scripts, launchd plist) are in `deploy/sol/`.
  Earlier the bridge also ran on Janus (LAN) and sol itself (`sol-local` escape hatch).

## 2. split-router

`src/split-router.ts` merges the native and Web model catalogs, routes each turn by
model slug, strips hop/forwarded/cookie headers, and replays thread environment for
Web turns (`split-router-environment.ts`). Deployed as a single bun bundle
(`router.js`) under `~/Library/Application Support/codex-model-router/`.
Lessons:
* Health = catalog served + one native and one Web turn, not just a port answering.
* Keep the router stateless; Codex config only points at it, so rollback is a
  one-line `model_provider` change.

## 3. Model catalog

See `docs/model-catalog-maintenance.md` and `scripts/sync-codex-model-catalog.ts`.
Native rows come from the official binary's `debug models --bundled` (descriptions
preserved); Web rows come from the gateway `/healthz.web_model_catalog`. Never infer
a Web model from a similarly named native model. Desktop reads the catalog only at
startup; do not restart running owners to refresh it.

## 4. Hooks and Codex config

CCW managed `multi_agent`, `multi_agent_v2 = false` and `agents.max_depth = 2` plus an
interrupt-lifecycle hook block in `~/.codex/config.toml`. On retirement the settings
stayed (they are valid for official Codex) and the CCW markers were removed.

## 5. Operating lessons

* Verify upstream by release **and commit**; three-way merge into the dirty checkout,
  never discard local fixes (send rebind, Pro compaction budget, sign-in classification).
* Pin Bun to the project version for test gates; older Bun timer mocks give false failures.
* ChatGPT Web sign-out must be detected and turns held, not failed; logins are done
  by the user over noVNC (tailnet only). Never copy cookies/sessions between hosts
  or into git.
* tailscale `--tls-terminated-tcp` straight to loopback avoided nginx/Cloudflare
  header injection problems.
* Launchd checks right after `bootout` race: wait for the job to disappear before
  asserting (this race stalled the retirement thread).
* Before deleting any archive, confirm it is not the only copy.

## 6. Retirement (2026-10-12)

1. Codex thread `01a12e70` backed up `~/.codex/config.toml`, switched to
   `provider=openai`, verified an official inference, booted out
   `ai.bozhi.codex-split-router`, and stalled on the launchctl race above.
2. Grok Bot finished: archived entry points (plist, `mars-ts`/`janus-web`/`sol-local`
   profiles, `codex-mars`/`codex-janus`), fixed config comments, removed 17843 from
   patrol checks, closed Censorate ticket DB-20261012-1303-01.
3. Code, units and this record pushed here; then all CCW programs, data and units
   were removed from sol and Mars. Audit text (`retirement.json`, reports) is kept
   in `~/Library/Application Support/dev-ops/ccw-retirement/` on sol.
