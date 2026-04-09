import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(repoRoot, "vendor", "t3code");
const patchFiles = [path.join(repoRoot, "patches", "t3code-web-desktop-bridge.partial.patch")];
const mode = process.argv[2] === "revert" ? "revert" : "apply";

function runGitApply(args) {
  return spawnSync("git", ["-C", upstreamRoot, "apply", ...args], {
    cwd: repoRoot,
    stdio: "pipe",
    env: process.env,
  });
}

for (const patchFile of patchFiles) {
  const canApply = runGitApply(["--check", patchFile]);
  const canReverse = runGitApply(["--reverse", "--check", patchFile]);

  if (mode === "apply") {
    if (canApply.status === 0) {
      const apply = runGitApply([patchFile]);
      if (apply.status !== 0) {
        process.stderr.write(apply.stderr);
        process.exit(apply.status ?? 1);
      }
      continue;
    }

    if (canReverse.status === 0) {
      continue;
    }
  } else {
    if (canReverse.status === 0) {
      const reverse = runGitApply(["--reverse", patchFile]);
      if (reverse.status !== 0) {
        process.stderr.write(reverse.stderr);
        process.exit(reverse.status ?? 1);
      }
      continue;
    }

    if (canApply.status === 0) {
      continue;
    }
  }

  process.stderr.write(canApply.stderr);
  process.stderr.write(canReverse.stderr);
  process.exit(1);
}
