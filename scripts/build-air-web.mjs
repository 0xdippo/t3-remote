import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(repoRoot, "vendor", "t3code");
const upstreamWebRoot = path.join(upstreamRoot, "apps", "web");

function fail(message) {
  console.error(`[air-web] ${message}`);
  process.exit(1);
}

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

if (!existsSync(path.join(upstreamRoot, "package.json"))) {
  fail("Missing upstream checkout at vendor/t3code.");
}

if (!existsSync(path.join(upstreamRoot, "node_modules"))) {
  fail("Missing upstream dependencies. Run `~/.bun/bin/bun install` in vendor/t3code first.");
}

const applyResult = spawnSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "apply-upstream-patches.mjs")],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (applyResult.status !== 0) {
  process.exit(applyResult.status ?? 1);
}

const result = spawnSync(resolveBunBinary(), ["run", "build"], {
  cwd: upstreamWebRoot,
  stdio: "inherit",
  env: process.env,
});

const revertResult = spawnSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "apply-upstream-patches.mjs"), "revert"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  fail(`Failed to build upstream web app: ${result.error.message}`);
}

if (revertResult.status !== 0) {
  process.exit(revertResult.status ?? 1);
}

process.exit(result.status ?? 0);
