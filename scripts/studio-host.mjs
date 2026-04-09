import crypto from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(repoRoot, "vendor", "t3code");
const upstreamServerRoot = path.join(upstreamRoot, "apps", "server");
const defaultBaseDir = path.join(repoRoot, ".local", "studio-host");
const defaultPort = "3773";
const defaultHost = "0.0.0.0";

const args = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: "string", default: defaultHost },
    port: { type: "string", default: defaultPort },
    token: { type: "string" },
    "advertise-host": { type: "string" },
    cwd: { type: "string" },
    "base-dir": { type: "string", default: defaultBaseDir },
    "no-browser": { type: "boolean", default: true },
    "auto-bootstrap-project-from-cwd": { type: "boolean", default: true },
    "log-ws-events": { type: "boolean", default: false },
  },
});

const cwd = path.resolve(args.values.cwd ?? args.positionals[0] ?? repoRoot);
const baseDir = path.resolve(args.values["base-dir"]);
const host = args.values.host;
const port = args.values.port;
const token = args.values.token?.trim() || crypto.randomBytes(24).toString("hex");
const advertiseHost = args.values["advertise-host"]?.trim() || null;

function resolveBunBinary() {
  const envBun = process.env.BUN_BIN?.trim();
  if (envBun) {
    return envBun;
  }

  const candidates = [
    path.join(os.homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    "bun",
  ];

  for (const candidate of candidates) {
    if (candidate === "bun" || existsSync(candidate)) {
      return candidate;
    }
  }

  return "bun";
}

function fail(message) {
  console.error(`[studio-host] ${message}`);
  process.exit(1);
}

function listLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = new Set();

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      addresses.add(entry.address);
    }
  }

  return [...addresses].sort();
}

if (!existsSync(path.join(upstreamRoot, "package.json"))) {
  fail("Missing upstream checkout at vendor/t3code. Run `git submodule update --init --recursive`.");
}

if (!existsSync(path.join(upstreamRoot, "node_modules"))) {
  fail(
    "Missing upstream dependencies. Run `~/.bun/bin/bun install` in vendor/t3code before starting the host.",
  );
}

const bunBinary = resolveBunBinary();
const bunArgs = [
  "run",
  "src/bin.ts",
  "--mode",
  "web",
  "--host",
  host,
  "--port",
  port,
  "--base-dir",
  baseDir,
  "--auth-token",
  token,
];

if (args.values["no-browser"]) {
  bunArgs.push("--no-browser");
}

if (args.values["auto-bootstrap-project-from-cwd"]) {
  bunArgs.push("--auto-bootstrap-project-from-cwd");
}

if (args.values["log-ws-events"]) {
  bunArgs.push("--log-ws-events");
}

bunArgs.push(cwd);

const loopbackHttpUrl = `http://127.0.0.1:${port}`;
const loopbackWsUrl = `ws://127.0.0.1:${port}/ws?token=${token}`;
const publicHost = advertiseHost || (host === "0.0.0.0" || host === "::" ? null : host);
const publicHttpUrl = publicHost ? `http://${publicHost}:${port}` : null;
const publicWsUrl = publicHost ? `ws://${publicHost}:${port}/ws?token=${token}` : null;
const lanWsUrls = publicWsUrl
  ? []
  : listLanAddresses().map((address) => `ws://${address}:${port}/ws?token=${token}`);

console.log("[studio-host] Launching upstream T3 server");
console.log(`[studio-host] workspace: ${cwd}`);
console.log(`[studio-host] state dir: ${baseDir}`);
console.log(`[studio-host] local http url: ${loopbackHttpUrl}`);
console.log(`[studio-host] local ws url: ${loopbackWsUrl}`);
if (publicHttpUrl && publicWsUrl) {
  console.log(`[studio-host] remote http url: ${publicHttpUrl}`);
  console.log(`[studio-host] remote ws url: ${publicWsUrl}`);
} else if (lanWsUrls.length > 0) {
  console.log("[studio-host] candidate LAN ws urls:");
  for (const candidate of lanWsUrls) {
    console.log(`[studio-host]   ${candidate}`);
  }
  console.log("[studio-host] Use one of the LAN URLs above from the Air client.");
}
console.log("[studio-host] Keep the token private if you bind beyond loopback.");

const child = spawn(bunBinary, bunArgs, {
  cwd: upstreamServerRoot,
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  fail(`Failed to start Bun/upstream server: ${error.message}`);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
