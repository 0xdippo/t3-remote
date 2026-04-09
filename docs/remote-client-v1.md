# Remote Client V1

Last reviewed against upstream `pingdotgg/t3code` commit `b96308fc5adba6eecae5ee26efcfc8a01caaafd2`.

## Goal

Build a narrow two-part system:

- Mac Studio runs the canonical T3 runtime.
- MacBook Air runs a thin native Tauri client that feels very close to T3 Code.

The Air client must never become a second writable worker. Repo access, terminals, session state, providers, and long-running execution stay on the Studio.

## Strongest Practical Path

Do **not** invent a new product architecture for v1.

Reuse upstream aggressively:

- Reuse upstream server on the Studio: `vendor/t3code/apps/server`
- Reuse upstream web UI on the Air: `vendor/t3code/apps/web`
- Reuse upstream contracts and WebSocket RPC protocol:
  - `vendor/t3code/packages/contracts`
  - `vendor/t3code/packages/client-runtime`

For v1, the safest low-rewrite shape is:

1. Studio runs the upstream server directly, bound for LAN/Tailscale use.
2. Air bundles the upstream web app inside a Tauri shell.
3. The Tauri shell injects a small `desktopBridge` compatible surface that points the web app at the Studio WebSocket endpoint.
4. The Studio remains the only execution environment.

This keeps drift low and avoids rebuilding the chat/session UX from scratch.

## What Is Already Reusable

### Frontend/UI reuse

These are already the T3 Code UI we want to preserve:

- Sidebar layout and thread/project navigation:
  - `vendor/t3code/apps/web/src/components/AppSidebarLayout.tsx`
  - `vendor/t3code/apps/web/src/components/Sidebar.tsx`
- Main chat/session view:
  - `vendor/t3code/apps/web/src/components/ChatView.tsx`
- Terminal drawer:
  - `vendor/t3code/apps/web/src/components/ThreadTerminalDrawer.tsx`
- Diff/git/status panels:
  - `vendor/t3code/apps/web/src/components/DiffPanel.tsx`
  - `vendor/t3code/apps/web/src/components/GitActionsControl.tsx`
- Routing and app bootstrap:
  - `vendor/t3code/apps/web/src/routes/__root.tsx`
  - `vendor/t3code/apps/web/src/routes/_chat.tsx`
  - `vendor/t3code/apps/web/src/main.tsx`

### Existing remote-capable client runtime

Upstream already expects a WebSocket-backed environment:

- known environment model:
  - `vendor/t3code/packages/client-runtime/src/knownEnvironment.ts`
- environment bootstrap:
  - `vendor/t3code/apps/web/src/environmentBootstrap.ts`
- WebSocket RPC client:
  - `vendor/t3code/apps/web/src/wsRpcClient.ts`
  - `vendor/t3code/apps/web/src/wsTransport.ts`
- environment API abstraction:
  - `vendor/t3code/apps/web/src/environmentApi.ts`
- local shell API abstraction:
  - `vendor/t3code/apps/web/src/localApi.ts`

This is the key reason a thin remote client is feasible without a large rewrite.

### Session/project state already lives on the server

Authoritative state is already projected server-side and streamed into the web store:

- orchestration snapshot/event schemas:
  - `vendor/t3code/packages/contracts/src/orchestration.ts`
- read model to web store mapping:
  - `vendor/t3code/apps/web/src/store.ts`
- snapshot bootstrap and live event routing:
  - `vendor/t3code/apps/web/src/routes/__root.tsx`
- server projection query and domain event streaming:
  - `vendor/t3code/apps/server/src/ws.ts`

Important implication:

- We do not need to create client-owned session state for v1.
- We should keep the Studio as the authority and let the Air subscribe.

### Terminal/process execution already lives on the server

- terminal manager:
  - `vendor/t3code/apps/server/src/terminal/Layers/Manager.ts`
- PTY adapters:
  - `vendor/t3code/apps/server/src/terminal/Layers/NodePTY.ts`
  - `vendor/t3code/apps/server/src/terminal/Layers/BunPTY.ts`
- terminal RPC wiring:
  - `vendor/t3code/apps/server/src/ws.ts`

### Provider wiring already lives on the server

- provider service:
  - `vendor/t3code/apps/server/src/provider/Layers/ProviderService.ts`
- Codex adapter:
  - `vendor/t3code/apps/server/src/provider/Layers/CodexAdapter.ts`
- Claude adapter:
  - `vendor/t3code/apps/server/src/provider/Layers/ClaudeAdapter.ts`
- provider registry/runtime:
  - `vendor/t3code/apps/server/src/provider/Layers/ProviderRegistry.ts`
  - `vendor/t3code/apps/server/src/server.ts`

This already matches the desired host/worker split.

## Electron-Specific Pieces To Replace Or Bypass

The current desktop shell is Electron-specific:

- Electron app entry:
  - `vendor/t3code/apps/desktop/src/main.ts`
- preload bridge:
  - `vendor/t3code/apps/desktop/src/preload.ts`
- Electron package:
  - `vendor/t3code/apps/desktop/package.json`

What Electron currently does:

- launches/manages a local server
- exposes `window.desktopBridge`
- provides dialogs/context menus/external link opening/theme sync/update flow

For v1 remote Tauri:

- replace local-server bootstrapping with remote host bootstrap
- preserve the `desktopBridge` contract shape where useful
- skip desktop auto-update parity and local backend management for now

## What Stays On Studio

- upstream server runtime
- SQLite state and projections
- repo/worktree access
- PTY/terminal sessions
- Codex/Claude provider sessions
- session lifecycle and orchestration events
- git status/diff generation
- attachment storage
- changed-files and diff data already emitted by current server flows

## What Moves To Air

- native window shell
- persisted host address/token settings
- runtime connection bootstrap into upstream web app
- small native affordances:
  - external link open
  - confirm dialog
  - theme sync
  - optional native context menu later

## Minimal Protocol For V1

Use the existing upstream WebSocket RPC endpoint at `/ws`.

Relevant operations already exist:

- list projects / list sessions / open session:
  - `orchestration.getSnapshot`
- live session/project updates:
  - `subscribeOrchestrationDomainEvents`
- create session:
  - `orchestration.dispatchCommand` with `thread.create`
- send prompt:
  - `orchestration.dispatchCommand` with `thread.turn.start`
- stop/cancel current action:
  - `orchestration.dispatchCommand` with `thread.turn.interrupt`
- terminal snapshot open:
  - `terminal.open`
- terminal live stream:
  - `subscribeTerminalEvents`
- terminal input/resize/clear/restart/close:
  - `terminal.write`
  - `terminal.resize`
  - `terminal.clear`
  - `terminal.restart`
  - `terminal.close`
- status/config/provider updates:
  - `subscribeServerConfig`
  - `subscribeServerLifecycle`
- changed files/diffs when already available:
  - `orchestration.getTurnDiff`
  - `orchestration.getFullThreadDiff`
- project file search/write if needed by existing UI:
  - `projects.searchEntries`
  - `projects.writeFile`
- git status streaming:
  - `subscribeGitStatus`

Conclusion:

- v1 does **not** need a brand-new protocol.
- v1 should standardize on the upstream RPC surface and only add a tiny host launch/config wrapper around it.

## Authentication For V1

Upstream already supports a WebSocket token query parameter:

- auth config and CLI:
  - `vendor/t3code/apps/server/src/cli.ts`
- auth enforcement:
  - `vendor/t3code/apps/server/src/ws.ts`

Recommended v1 posture:

- local network or Tailscale only
- require an auth token when binding beyond loopback
- store token locally in the Air client settings
- keep the token in the configured WebSocket URL for now

This is not full auth, but it avoids the obvious footgun of an unauthenticated LAN-exposed worker.

### Codex account profiles

Remote V1 now keeps a lightweight profile manifest on the Studio under
`<repo>/.local/studio-host/codex-profiles`. Each profile entry owns a dedicated
`CODEX_HOME` directory so Codex CLI tokens never mix across accounts. The active
profile is also persisted in `profiles.json` so that restarts reuse the last
selection.

Switching rules:

- Switching is blocked if any Codex thread is running.
- Codex auth stays on the Studio; the Air UI only sends profile commands.
- Re-authenticating a profile runs `codex logout` for that profile and returns
  the exact `CODEX_HOME=… codex login` command to paste into a Studio terminal.

## Recommended V1 Build Plan

### Phase 1

- Vendor upstream as a submodule.
- Keep this doc current.

### Phase 2

Build a small Studio host wrapper around upstream server:

- simple dev/start scripts
- explicit `host`, `port`, `authToken`, `cwd`, `noBrowser`
- default to upstream server, not a new host implementation

### Phase 3

Build a thin Air Tauri shell:

- bundle upstream web app assets
- provide a `desktopBridge` compatible runtime bootstrap
- point the web app to the Studio endpoint
- keep local shell APIs thin

### Phase 4

Only patch upstream web where remote Tauri behavior differs materially:

- connection settings/bootstrap
- shell detection if Electron assumptions are too narrow
- any places that incorrectly assume a local backend

## Fork-In-The-Road Decisions

### Decision: new remote protocol vs reuse upstream RPC

Choose reuse upstream RPC.

Reason:

- It already covers snapshot, streaming events, terminal, git, and server config.
- Replacing it would create the exact large permanent fork we want to avoid.

### Decision: remote web page in Tauri vs bundled local web assets in Tauri

Choose bundled local web assets in Tauri for v1.

Reason:

- better native feel
- no browser-first dependency on the Studio serving HTML
- host remains execution-only
- easier to add local connection settings and reconnect UX

### Decision: port Studio desktop app vs keep Studio simple

Choose simple Studio host.

Reason:

- upstream `apps/server` already matches the desired authority boundary
- the Studio does not need a polished shell for v1

## Risks

- Upstream moves quickly, so web integration points may shift.
- Upstream currently identifies desktop shell with `isElectron`; Tauri should avoid depending on Electron-only semantics.
- Upstream build tooling currently prefers Bun; local wrapper scripts should not assume Bun is always present.
- Some UX features in settings/update flows are desktop-specific and should be disabled or deferred in the Tauri build instead of partially re-implementing them.

## V1 Non-Goals

- multi-host orchestration
- dual writable peers
- plugin system
- full Electron parity
- large auth system
- browser admin surface
- broad server rewrites

## Practical Recommendation

Treat this project as:

- a thin launcher/config wrapper around upstream server on the Studio
- a thin Tauri shell around upstream web on the Air

That gives the closest path to a recognizably T3 Code remote client without turning this repo into a forked reimplementation.
