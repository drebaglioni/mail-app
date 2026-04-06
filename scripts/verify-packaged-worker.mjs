import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const OLD_MODEL_ERROR =
  "The selected model is not supported by Codex. Exo will use your configured Codex model (for example: o3). Retry the agent run.";
const NEW_MODEL_ERROR =
  "The selected model is not supported by Codex. Exo retried with Codex's default model, but the request still failed. Set a supported model in Settings (for example: o3) and retry.";

function resolveAsarPath(inputArg) {
  if (!inputArg) {
    return "release/mac-arm64/Exo.app/Contents/Resources/app.asar";
  }
  if (inputArg.endsWith(".app")) {
    return join(inputArg, "Contents/Resources/app.asar");
  }
  return inputArg;
}

function extractAsarFile(asarPath, asarInnerPath) {
  const dir = mkdtempSync(join(tmpdir(), "exo-verify-worker-"));
  try {
    execFileSync("npx", ["asar", "extract-file", asarPath, asarInnerPath], {
      cwd: dir,
      stdio: "ignore",
    });
    const outputName = basename(asarInnerPath);
    return readFileSync(join(dir, outputName));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const asarPath = resolve(process.cwd(), resolveAsarPath(process.argv[2]));
  if (!existsSync(asarPath)) {
    throw new Error(`ASAR not found: ${asarPath}`);
  }

  const workerEntry = extractAsarFile(asarPath, "out/worker/agent-worker.cjs").toString("utf8");
  const chunkMatch = workerEntry.match(/require\("\.\/(agent-worker-[^"]+\.cjs)"\)/);
  if (!chunkMatch) {
    throw new Error("Could not resolve active worker chunk from out/worker/agent-worker.cjs");
  }
  const activeChunkName = chunkMatch[1];
  const activeChunkPath = `out/worker/${activeChunkName}`;

  const chunkSource = extractAsarFile(asarPath, activeChunkPath).toString("utf8");
  if (chunkSource.includes(OLD_MODEL_ERROR)) {
    throw new Error(
      `Stale packaged worker detected. Active chunk ${activeChunkName} still contains old Codex model error text.`,
    );
  }
  if (!chunkSource.includes(NEW_MODEL_ERROR)) {
    throw new Error(
      `Active chunk ${activeChunkName} does not contain expected new Codex model error text.`,
    );
  }

  console.log(`OK: active worker chunk ${activeChunkName} is up to date in ${asarPath}`);
}

main();
