import path from "node:path";
import { z } from "zod";
import { readOptionalFile } from "./files";
import { countCommits, probeGit, readGit } from "./git";

export interface WorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  isMain: boolean;
  isPrunable: boolean;
}

export interface BaseBranch {
  name: string;
  localSha: string | null;
  remoteSha: string | null;
}

export interface Repository {
  root: string;
  name: string;
  worktrees: WorktreeEntry[];
  /** Tip of every local branch and origin branch, keyed by full ref name. */
  refs: ReadonlyMap<string, string>;
  base: BaseBranch | null;
  unpushedCommits: number | null;
  /** Directories inside the repository that hold linked worktrees, such as `.worktrees`. */
  containers: string[];
}

const BRANCH_PREFIX = "refs/heads/";
const ORIGIN_PREFIX = "refs/remotes/origin/";
const FALLBACK_BASE_NAMES = ["main", "master"];

const PaseoWorktreeMetadataSchema = z.object({
  baseRef: z.string().optional(),
  baseRefName: z.string().optional(),
});

function parseWorktreeList(root: string, output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  let isBare = false;
  for (const line of output.split("\0")) {
    if (line === "") {
      if (current && !isBare) entries.push(current);
      current = null;
      isBare = false;
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") {
      current = {
        path: value,
        head: null,
        branch: null,
        isMain: value === root,
        isPrunable: false,
      };
    } else if (current && key === "HEAD") current.head = value;
    else if (current && key === "branch") current.branch = value.replace(BRANCH_PREFIX, "");
    else if (current && key === "prunable") current.isPrunable = true;
    else if (key === "bare") isBare = true;
  }
  return entries;
}

async function readWorktrees(root: string): Promise<WorktreeEntry[]> {
  const output = await readGit(root, ["worktree", "list", "--porcelain", "-z"]);
  return parseWorktreeList(root, output);
}

async function readRefs(root: string): Promise<Map<string, string>> {
  const output = await readGit(root, [
    "for-each-ref",
    "--format=%(refname)%00%(objectname)",
    "refs/heads",
    "refs/remotes/origin",
  ]);
  const refs = new Map<string, string>();
  for (const line of output.split("\n")) {
    const [name, sha] = line.split("\0");
    if (name && sha) refs.set(name, sha);
  }
  return refs;
}

/**
 * Same order as Paseo: origin/HEAD first, then a local main or master. Repositories without
 * either fall back to whatever the main checkout has checked out.
 */
async function resolveBaseName(
  root: string,
  refs: ReadonlyMap<string, string>,
  worktrees: readonly WorktreeEntry[],
): Promise<string | null> {
  const originHead = await probeGit(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (originHead.exitCode === 0) return originHead.stdout.trim().replace(ORIGIN_PREFIX, "");
  const conventional = FALLBACK_BASE_NAMES.find((name) => refs.has(BRANCH_PREFIX + name));
  return conventional ?? worktrees.find((entry) => entry.isMain)?.branch ?? null;
}

export function toBaseBranch(name: string, refs: ReadonlyMap<string, string>): BaseBranch {
  const shortName = name.replace(/^origin\//, "");
  const remoteSha = refs.get(ORIGIN_PREFIX + shortName) ?? null;
  // Without a local branch the remote branch is the only base there is.
  const localSha = refs.get(BRANCH_PREFIX + shortName) ?? remoteSha;
  return { name: shortName, localSha, remoteSha };
}

async function countUnpushed(root: string, base: BaseBranch | null): Promise<number | null> {
  if (base === null || base.localSha === null || base.remoteSha === null) return null;
  if (base.localSha === base.remoteSha) return 0;
  return countCommits(root, `${base.remoteSha}..${base.localSha}`);
}

function findContainers(root: string, worktrees: readonly WorktreeEntry[]): string[] {
  const parents = worktrees
    .filter((worktree) => !worktree.isMain)
    .map((worktree) => path.dirname(worktree.path))
    .filter((parent) => parent.startsWith(root + path.sep));
  return [...new Set(parents)];
}

export async function readRepository(root: string): Promise<Repository> {
  const [worktrees, refs] = await Promise.all([readWorktrees(root), readRefs(root)]);
  const baseName = await resolveBaseName(root, refs, worktrees);
  const base = baseName === null ? null : toBaseBranch(baseName, refs);
  return {
    root,
    name: path.basename(root),
    worktrees,
    refs,
    base,
    unpushedCommits: await countUnpushed(root, base),
    containers: findContainers(root, worktrees),
  };
}

/** Paseo-owned worktrees record the branch they were cut from; that base wins over the default. */
export async function readPaseoBaseName(worktreePath: string): Promise<string | null> {
  // The main checkout has a .git directory rather than a pointer file.
  const pointer = await readOptionalFile(path.join(worktreePath, ".git"));
  if (pointer === null) return null;
  const gitDir = path.resolve(worktreePath, pointer.replace(/^gitdir:\s*/, "").trim());
  const raw = await readOptionalFile(path.join(gitDir, "paseo", "worktree.json"));
  if (raw === null) return null;
  // Foreign metadata that does not parse falls back to the repository default.
  const metadata = PaseoWorktreeMetadataSchema.safeParse(JSON.parse(raw));
  if (!metadata.success) return null;
  return metadata.data.baseRef ?? metadata.data.baseRefName ?? null;
}
