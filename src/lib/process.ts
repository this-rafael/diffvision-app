import { spawn } from "node:child_process";
import { logAll } from "./logger";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const startedAt = Date.now();
  logAll("process", "spawn", { command, args, cwd });

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      logAll("process", "spawn error", {
        command,
        args,
        cwd,
        message: error.message,
      });
      reject(error);
    });

    child.on("close", (exitCode) => {
      logAll("process", "spawn close", {
        command,
        args,
        cwd,
        exitCode: exitCode ?? 1,
        elapsedMs: Date.now() - startedAt,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
      });
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

export async function runGit(
  args: string[],
  cwd: string,
  allowFailure = false,
): Promise<string> {
  logAll("git", "run", { args, cwd, allowFailure });
  const result = await runCommand("git", args, cwd);

  if (result.exitCode !== 0 && !allowFailure) {
    logAll("git", "failed", {
      args,
      cwd,
      exitCode: result.exitCode,
      stderr: result.stderr.trim(),
    });
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }

  logAll("git", "completed", {
    args,
    cwd,
    exitCode: result.exitCode,
  });

  return result.stdout.trimEnd();
}
