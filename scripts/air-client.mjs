import { parseArgs } from "node:util";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tauriBin = path.join(repoRoot, "node_modules", ".bin", "tauri");
const [command = "dev", ...restArgs] = process.argv.slice(2);

if (command !== "dev" && command !== "build") {
  console.error("[air-client] First argument must be `dev` or `build`.");
  process.exit(1);
}

const parsed = parseArgs({
  args: restArgs,
  allowPositionals: true,
  options: {
    "ws-url": { type: "string" },
    label: { type: "string", default: "Studio host" },
  },
});

const wsUrl = parsed.values["ws-url"]?.trim() || process.env.T3_REMOTE_WS_URL?.trim();
const label = parsed.values.label?.trim() || process.env.T3_REMOTE_LABEL?.trim() || "Studio host";

if (!wsUrl) {
  console.error("[air-client] Missing remote websocket URL.");
  console.error("[air-client] Pass `--ws-url ws://HOST:PORT/ws?token=...` or set T3_REMOTE_WS_URL.");
  process.exit(1);
}

const buildWeb = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "build-air-web.mjs")], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (buildWeb.status !== 0) {
  process.exit(buildWeb.status ?? 1);
}

const tauriArgs =
  command === "build" ? ["build", "--bundles", "app", ...parsed.positionals] : ["dev", ...parsed.positionals];

const result = spawnSync(tauriBin, tauriArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    T3_REMOTE_WS_URL: wsUrl,
    T3_REMOTE_LABEL: label,
  },
});

process.exit(result.status ?? 1);
