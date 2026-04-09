# T3 Remote Client V1

This repo keeps the first remote-client build narrow:

- The host machine runs the upstream T3 server and owns execution.
- The client machine runs a thin Tauri shell that bundles the upstream web UI.
- The client never becomes a second repo worker.

See [docs/remote-client-v1.md](docs/remote-client-v1.md) for the architecture note and upstream code-map.

## Current shape

- Upstream source is vendored under [vendor/t3code](vendor/t3code).
- Host launcher: [scripts/studio-host.mjs](scripts/studio-host.mjs)
- Client build/dev launcher: [scripts/air-client.mjs](scripts/air-client.mjs)
- Tauri shell: [src-tauri](src-tauri)

## First run

Install root dependencies:

```bash
bun install
```

Install upstream dependencies:

```bash
cd vendor/t3code
bun install
```

Start the host:

```bash
node scripts/studio-host.mjs --host 0.0.0.0
```

The launcher prints loopback and candidate LAN websocket URLs with the auth token.

Run the client in development:

```bash
node scripts/air-client.mjs dev --ws-url 'ws://STUDIO_IP:3773/ws?token=...'
```

Build the macOS app bundle:

```bash
node scripts/air-client.mjs build --ws-url 'ws://STUDIO_IP:3773/ws?token=...'
```

The built app lands under `src-tauri/target/release/bundle/macos`.
The `--ws-url` and `--label` values are embedded into the built app as first-launch defaults, and then persisted locally by the client.

## Reuse strategy

This v1 intentionally reuses upstream instead of forking the product shape:

- The host reuses upstream `apps/server`
- The client reuses upstream `apps/web`
- RPC and state streaming reuse upstream websocket contracts

There is a very small compatibility patch for the web app so it can run inside the reduced Tauri bridge surface. That patch is applied only for build time and then reverted to keep the vendored upstream tree clean.
