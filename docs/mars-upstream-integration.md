# Mars upstream integration

## 6.1.6 candidate validated (2026-10-08)

Upstream `388fca546553921cfc3b695930bd7140ce99d486` adds explicit GPT-6
Sol/Instant routes, measured GPT-6 context limits, current picker handling,
login-independent runtime startup and update-download recovery. All 43 changed
files were three-way integrated without discarding the canonical dirty checkout.
Mars preserves its owner-aware detached-menu recovery, sign-in classification,
send rebind and Pro compaction budget. Cancellation now takes priority over
sign-in diagnosis in navigation recovery. Existing explicit 5.6 task bindings
remain unchanged; legacy Latest aliases use the GPT-6 context contract.

Core regression with the project-pinned Bun 1.4.0: 1027 passed / 45 skipped;
launcher: 385 passed / 2 skipped; isolated Chromium picker/response fixtures:
32 passed. Core/launcher typechecks and renderer build passed. The Linux
relocatable-runtime smoke passed; the initial partial Linux test source lacked
launcher fixtures, whose 25-test rerun passed after restoring the inputs.
The oversized multipart fixture exceeded its 60-second allowance on Mars; a
task-scoped 120-second rerun kept every assertion and production input unchanged.
The canonical pinned-Bun suite passed with the original timeout.
Initial local runs used Bun 1.3.8 and failed its unsupported timer mocks; those
runs remain evidence, not release gates. Evidence and rollback-capable release
script: `~/Local/codex-chatgpt-web/operations/upstream-6.1.6-20261008/`.

Candidate runtime bundle:
`0f250af6a7a90a91a29e4927ff9c4f505413625207fd286354889811adf73cef`.
Post-release main `307763887a8ba61143ac12815856f4f0d92885d2` contributes
one additional fix: keep browser-pane dimensions stable when parallel tabs finish.
Its four files were three-way merged into the existing candidate. Launcher tests
now pass 386 / skip 2. A separate Linux/Xvfb Electron fixture passes 18 assertions
at normal and 1.25 zoom; the old implementation fails the viewport invariant.
The generated fixture opens its menu through renderer DOM events because native
mouse hit testing cannot reach an offscreen view. This proves resize behavior,
not real ChatGPT model selection. The first unadapted fixture timed out and remains
in the evidence directory. Release identity stays 6.1.6 / `388fca5`; the extra fix
is recorded separately. The CLI runtime bundle is unchanged; candidate r2 replaces
only `app.asar`, SHA `12f3cbf74328b4a152895b593294a5eab28a87c8e3c4f6f19e5d1ecaceb75b58`.
Increment evidence: `~/Local/codex-chatgpt-web/operations/upstream-6.1.6-main-3077638/`;
remote stage: `~/.local/state/ccw-upstream-616-3077638/`.
Release remains pending a naturally idle bridge/browser/admission/queue state.
Do not interrupt active owners to install it. After the same-consumer switch,
verify runtime hashes, tunnel child, exact catalog and original business tools.
Visible Codex selector acceptance retains the existing explicit GUI-denial
boundary; network or CLI metadata cannot replace that evidence.

## 6.1.5 deployed (2026-10-07)

Upstream `92a356fac2292e3af5a97ab7ba634edd8d38621e` adds multipart context
upload/rebinding, tool approval handling, corrupt environment-cache preservation,
and primary login navigation recovery. The 54 changed files were three-way merged
against the retained 6.1.4 source without discarding local dirty changes. Mars keeps
its exact turn ownership, delayed user-node checks, trusted cwd continuity and
host-written environment refresh; cache recovery now preserves invalid JSON before
rebuilding only from verified current authority. Dependency overrides retain
`ip-address@10.7.2` and add upstream `proxy-addr@2.0.8`.

Candidate: `6.1.5-mars.1-r1`, Electron `41.10.7`. Evidence lives at
`~/Local/codex-chatgpt-web/operations/upstream-6.1.5-20261007/` (original bytes,
merged inputs, tests and deployment script). Core regression: 1012 passed / 41
skipped; launcher: 382 passed / 2 skipped; real isolated Chromium fixtures: 47
passed; conflict regression: 111 passed / 4 skipped. Core and launcher typechecks,
renderer build and Linux relocatable-runtime smoke passed. An installer process
fixture failed once under the initial suite; its targeted rerun and final complete
launcher suite passed.

Deployed after natural empty HTTP/browser/admission/queue state, with admission
fenced and reopened. Bridge, launcher and tunnel use the same verified bundle
`fd89d38e037ebce119d55fa5664bad7674a41705eabe52a9cd83c35e84e6cdec`;
rollback is retained. The public console shows live 6.1.5 data. A synthetic
`chatgpt-web/gpt-5.6-sol / high` request completed in 28.73 seconds; Markdown
escapes caused the probe literal marker predicate to miss the correct output.
The first navigation failure (`ERR_NETWORK_CHANGED`) remains in evidence.
Official installed Codex catalog has four visible CCW models; catalog sync was
unchanged. Existing business continued on its current official Sol Medium setting
without intervention; this is not original CCW business-tool recovery evidence.
The pre-existing Codex GUI selector inspection denial remains unresolved; CLI
models do not establish GUI selector acceptance. No running owner was interrupted.

## 6.1.4 baseline and retained policy

Upstream commit: `b6ca2d3f91f8a2ba140b522fe3b3c50b4ebffa2d` (v6.1.4).
Runtime reports upstream version and separate `fork_revision` / `upstream_commit`
fields; a version string alone is not deployment evidence. Mars keeps one Alpha
host, five physical browser turns, the upstream model picker, and existing task
model bindings. No default approval setting is enabled by this integration.

All 57 upstream changed files were integrated by three-way comparison, preserving
the pre-existing working tree. Upstream's cancellation isolation, repeated-block
and formula fixes, per-message connector selection, Activity/approval UI, update
transport, and dependency changes are included. Local remote-environment,
single-host, account-budget, and diagnostic extensions remain.

## One queue for automatic launcher execution

The session registry deduplicates reconnects and retains per-thread ownership; it
does not independently compete for physical capacity on the automatic launcher
route. The helper's account admission queue alone combines capacity, rolling
request budgets, cooldown, and recovery probes. Direct/manual paths retain their
existing capacity protection.

- Schedule by thread, round-robin across threads and FIFO within each queue.
- Existing tool-result observers attach to the existing session without acquiring
  another slot. A queue must never prevent the work required to release its slots.
- Release admission only when the helper's actual run/cleanup settles. An early
  cancellation response is not proof that the browser is free.
- Bound pending admission to 256 items. Ordinary sixth requests queue; true queue
  overload has an explicit retryable `chatgpt_queue_full` error.
- Cancelled waiters are removed from both the scheduler and the persisted view.
- `/healthz.admission` exposes physical running count, queued count, maximum,
  oldest wait, and historical queue-wait P50/P95. The legacy `active_browser_turns`
  counts unsettled sessions (including waiting work), not physical documents.
- Persisted live state is observation, not a replay queue. Never automatically
  replay an uncertain submitted request after a process restart.

## Regression evidence and release gate

Integration evidence and rollback artifacts are stored outside Documents at
`~/Local/codex-chatgpt-web/operations/upstream-6.1.4-integration/`.
The core suite, launcher suite, real Chromium fixtures, and shared queue tests
cover separate layers; none alone establishes production acceptance.

Required production acceptance: six simultaneous harmless Responses requests,
peak physical occupancy five and at least one queued, six valid results, and a
retained follow-up. Inspect installed launcher Activity/settings without changing
the user's model or optional approval preferences. No business messages are used.

The bridge, launcher helper, and tunnel MCP child are separate runtime consumers.
Switch the Alpha profile's `mcp.commands[0].command` to the candidate runtime in
the same release operation; restarting the bridge does not update or restart the
tunnel. Back up the profile with mode 0600 and preserve all authentication fields.
Validate with `tunnel-client doctor`, restart only the affected tunnel after its
in-flight calls settle, then verify the live child command as well as the profile.
Run the dev-ops `scripts/cwg-verify-runtime RUNTIME --profile PROFILE` on Mars as
a required release gate: it checks manifest hashes, configured MCP command, live
bridge command, and live tunnel child. A healthy poll or `readyz` alone is not
tool acceptance; read back a completed native tool in the original Codex chat.
On rollback restore both the runtime units and the saved profile before restarting
the tunnel. Never report the release complete with an older MCP child still live.

Prepare an independent Mars release directory and verify every runtime hash
before service changes. Switch only after HTTP/browser/admission/queue are empty,
then drain and recheck. Always resume admission if a gate fails. Keep original
installation and unit settings for rollback. Do not send checkpoint instructions
to active chats to create a deployment window: such instructions can supersede
their current turn.

## Shared writer

An idle status at the beginning of a long build is not a lasting reservation.
The maintenance task must acknowledge the integration owner before another
writer builds from or deploys this checkout. Transfer ownership with the exact
candidate, test evidence, deployment state, and remaining acceptance gates.
Do not call a partial hotfix carrying new source a complete upstream release.
