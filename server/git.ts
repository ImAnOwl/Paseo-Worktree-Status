import { execFile } from "node:child_process";

// Optional locks off: frequent status reads must never take index.lock from agents committing.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const TIMEOUT_MS = 10_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const MAX_CONCURRENT = 4;

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed with ${exitCode ?? "no exit code"}: ${stderr.trim()}`);
    this.name = "GitCommandError";
  }
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let active = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

function spawnGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, "-c", "core.quotepath=off", ...args],
      { env: GIT_ENV, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) resolve({ exitCode: 0, stdout, stderr });
        else if (typeof error.code === "number") resolve({ exitCode: error.code, stdout, stderr });
        else reject(new GitCommandError(args, null, error.message));
      },
    );
  });
}

/** Runs git and reports any exit code; rejects only when git could not run to completion. */
export async function probeGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  await acquireSlot();
  try {
    return await spawnGit(cwd, args);
  } finally {
    releaseSlot();
  }
}

/** Runs git and returns stdout; any non-zero exit is a GitCommandError. */
export async function readGit(cwd: string, args: readonly string[]): Promise<string> {
  const result = await probeGit(cwd, args);
  if (result.exitCode !== 0) throw new GitCommandError(args, result.exitCode, result.stderr);
  return result.stdout;
}

export async function countCommits(cwd: string, range: string): Promise<number> {
  return Number((await readGit(cwd, ["rev-list", "--count", range])).trim());
}
