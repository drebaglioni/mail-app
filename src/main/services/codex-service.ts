import { execFile, spawn } from "child_process";
import { createLogger } from "./logger";

const log = createLogger("codex-service");

export interface CodexAuthStatus {
  cliAvailable: boolean;
  authenticated: boolean;
  statusText?: string;
}

export interface CodexExecOptions {
  model?: string;
  cliPath?: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CodexExecResult {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  rawStdout: string;
  rawStderr: string;
}

export async function getCodexAuthStatus(cliPath: string = "codex"): Promise<CodexAuthStatus> {
  return new Promise((resolve) => {
    execFile(cliPath, ["login", "status"], { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        const anyErr = error as NodeJS.ErrnoException;
        if (anyErr.code === "ENOENT") {
          resolve({ cliAvailable: false, authenticated: false });
          return;
        }
        const text = (stderr || stdout || error.message || "").trim();
        resolve({
          cliAvailable: true,
          authenticated: /logged in/i.test(text),
          statusText: text || undefined,
        });
        return;
      }

      const text = (stdout || stderr || "").trim();
      resolve({
        cliAvailable: true,
        authenticated: /logged in/i.test(text),
        statusText: text || undefined,
      });
    });
  });
}

export async function runCodexExec(
  prompt: string,
  opts: CodexExecOptions = {},
): Promise<CodexExecResult> {
  const cliPath = opts.cliPath || "codex";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  try {
    return await runCodexExecOnce(prompt, {
      ...opts,
      cliPath,
      timeoutMs,
      model: opts.model,
    });
  } catch (firstError) {
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);

    // Some app flows pass an Anthropic model id into Codex (or users may set an
    // unsupported model in Settings). Retry once without --model so Codex can use
    // its own configured default model.
    if (opts.model && isUnsupportedModelError(firstMessage)) {
      log.warn(
        `[Codex] Model "${opts.model}" is unsupported; retrying request with Codex default model`,
      );
      try {
        return await runCodexExecOnce(prompt, {
          ...opts,
          cliPath,
          timeoutMs,
          model: undefined,
        });
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(normalizeCodexError(retryMessage));
      }
    }

    throw new Error(normalizeCodexError(firstMessage));
  }
}

async function runCodexExecOnce(
  prompt: string,
  opts: Required<Pick<CodexExecOptions, "cliPath" | "timeoutMs">> &
    Omit<CodexExecOptions, "cliPath" | "timeoutMs">,
): Promise<CodexExecResult> {
  const args: string[] = [
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--json",
  ];

  if (opts.model) {
    args.push("--model", opts.model);
  }
  args.push("-");

  return new Promise((resolve, reject) => {
    const child = spawn(opts.cliPath, args, {
      cwd: opts.cwd || process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      signal: opts.signal,
    });

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        reject(new Error(`Codex request timed out after ${opts.timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        const msg = (stderr || stdout || "").trim();
        reject(new Error(msg || `codex exited with code ${code}`));
        return;
      }

      const parsed = parseCodexJsonl(stdout);
      resolve({
        text: parsed.text,
        usage: parsed.usage,
        rawStdout: stdout,
        rawStderr: stderr,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function testCodexConnection(
  opts: Pick<CodexExecOptions, "cliPath" | "model" | "cwd"> = {},
): Promise<void> {
  const res = await runCodexExec("Reply with exactly READY and nothing else.", {
    ...opts,
    timeoutMs: 20_000,
  });
  const answer = res.text.trim();
  if (!answer) {
    throw new Error("Codex returned an empty response");
  }
  log.info(`[Codex] Health response: ${answer.slice(0, 120)}`);
}

function normalizeCodexError(message: string): string {
  if (
    /model is not supported when using Codex with a ChatGPT account/i.test(message) ||
    /invalid_request_error/i.test(message) ||
    /claude-opus-4-6/i.test(message)
  ) {
    return "The selected model is not supported by Codex. Exo retried with Codex's default model, but the request still failed. Set a supported model in Settings (for example: o3) and retry.";
  }
  if (
    /not inside a trusted directory/i.test(message) ||
    /--skip-git-repo-check was not specified/i.test(message)
  ) {
    return "Codex blocked this run because the current directory is not trusted. Exo now passes --skip-git-repo-check automatically; if this persists, update Codex CLI and retry.";
  }
  return message;
}

function isUnsupportedModelError(message: string): boolean {
  return (
    /model is not supported when using Codex with a ChatGPT account/i.test(message) ||
    /invalid_request_error/i.test(message) ||
    /unsupported model/i.test(message) ||
    /unknown model/i.test(message) ||
    /claude-opus-4-6/i.test(message)
  );
}

function parseCodexJsonl(stdout: string): {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
} {
  let lastText = "";
  let usage: Record<string, number> = {};

  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (evt.type === "item.completed") {
        const item = evt.item as Record<string, unknown> | undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") {
          lastText = item.text;
        }
      }
      if (evt.type === "turn.completed") {
        const evtUsage = evt.usage as Record<string, number> | undefined;
        if (evtUsage) {
          usage = evtUsage;
        }
      }
    } catch {
      // Ignore malformed JSONL rows.
    }
  }

  const fallback = stdout.trim();
  return {
    text: lastText || fallback,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      // Codex exposes cached_input_tokens; map to read-cache field for shared reporting.
      cache_read_input_tokens: usage.cached_input_tokens || 0,
      cache_creation_input_tokens: 0,
    },
  };
}
