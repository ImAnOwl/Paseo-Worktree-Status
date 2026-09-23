import type { ChangeCounts, WorktreeStatus } from "../shared/contracts";
import type { IntegrationFacts } from "../shared/state";
import { deriveState, parsePorcelain } from "../shared/state";
import { countCommits, GitCommandError, probeGit, readGit } from "./git";
import type { BaseBranch, Repository } from "./repository";
import { readPaseoBaseName, toBaseBranch } from "./repository";

/** Beyond this distance `git cherry` gets slow; the plain commit count is used instead. */
const MAX_CHERRY_DISTANCE = 1500;
const INTEGRATION_CACHE_SIZE = 2000;
const NO_CHANGES: ChangeCounts = { modified: 0, untracked: 0, conflicted: 0 };

export interface WorktreeTarget {
  path: string;
  branch: string | null;
  tip: string | null;
  presence: WorktreeStatus["presence"];
  isMainCheckout: boolean;
}

interface IntegrationQuery {
  root: string;
  tip: string;
  base: BaseBranch;
  branch: string | null;
  isBaseBranch: boolean;
}

// Facts for fixed commit ids never change, so they are cached until evicted.
const integrationCache = new Map<string, IntegrationFacts | null>();

export async function readChanges(worktreePath: string): Promise<ChangeCounts> {
  const output = await readGit(worktreePath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=normal",
  ]);
  return parsePorcelain(output);
}

async function countNotContained(root: string, upstream: string, tip: string): Promise<number> {
  const ahead = await countCommits(root, `${upstream}..${tip}`);
  if (ahead === 0) return 0;
  const behind = await countCommits(root, `${tip}..${upstream}`);
  if (behind > MAX_CHERRY_DISTANCE) return ahead;
  // Cherry-picked and rebased commits are listed with "-" because their patch is already upstream.
  const cherry = await readGit(root, ["cherry", upstream, tip]);
  return cherry.split("\n").filter((line) => line.startsWith("+")).length;
}

const UNTOUCHED_REFLOG = [/^branch: Created from /, /^reset: moving to /];

async function readHasWorked(root: string, branch: string): Promise<boolean | null> {
  const result = await probeGit(root, [
    "reflog",
    "show",
    "--format=%gs",
    `refs/heads/${branch}`,
    "--",
  ]);
  const subjects = result.stdout.split("\n").filter((line) => line !== "");
  if (result.exitCode !== 0 || subjects.length === 0) return null;
  return subjects.some((subject) => !UNTOUCHED_REFLOG.some((pattern) => pattern.test(subject)));
}

async function computeIntegration(query: IntegrationQuery): Promise<IntegrationFacts | null> {
  const { root, tip, base, branch, isBaseBranch } = query;
  if (base.localSha === null) return null;
  const ownCommits = await countCommits(root, `${base.localSha}..${tip}`);
  const notInBase = ownCommits === 0 ? 0 : await countNotContained(root, base.localSha, tip);
  const notInOrigin =
    base.remoteSha === null ? null : await countNotContained(root, base.remoteSha, tip);
  const needsReflog = ownCommits === 0 && !isBaseBranch && branch !== null;
  const hasWorked = needsReflog ? await readHasWorked(root, branch) : null;
  return { ownCommits, notInBase, notInOrigin, hasWorked, isBaseBranch };
}

async function readIntegration(query: IntegrationQuery): Promise<IntegrationFacts | null> {
  const { tip, base, branch, isBaseBranch } = query;
  const key = [tip, base.localSha, base.remoteSha, branch, isBaseBranch].join("|");
  const cached = integrationCache.get(key);
  if (cached !== undefined) return cached;
  const facts = await computeIntegration(query);
  if (integrationCache.size >= INTEGRATION_CACHE_SIZE) {
    const oldest = integrationCache.keys().next();
    if (!oldest.done) integrationCache.delete(oldest.value);
  }
  integrationCache.set(key, facts);
  return facts;
}

async function resolveBase(
  repository: Repository,
  target: WorktreeTarget,
): Promise<BaseBranch | null> {
  const paseoBase = target.presence === "present" ? await readPaseoBaseName(target.path) : null;
  return paseoBase === null ? repository.base : toBaseBranch(paseoBase, repository.refs);
}

async function readTargetIntegration(
  repository: Repository,
  target: WorktreeTarget,
  base: BaseBranch | null,
): Promise<IntegrationFacts | null> {
  if (base === null || target.tip === null) return null;
  return readIntegration({
    root: repository.root,
    tip: target.tip,
    base,
    branch: target.branch,
    isBaseBranch: target.branch === base.name,
  });
}

interface StatusDetails {
  changes: ChangeCounts;
  integration: IntegrationFacts | null;
  baseBranch: string | null;
  error: string | null;
}

function describe(
  repository: Repository,
  target: WorktreeTarget,
  { changes, integration, baseBranch, error }: StatusDetails,
): WorktreeStatus {
  const state =
    error === null ? deriveState({ presence: target.presence, changes, integration }) : "unknown";
  return {
    path: target.path,
    repositoryRoot: repository.root,
    repositoryName: repository.name,
    branch: target.branch,
    isMainCheckout: target.isMainCheckout,
    presence: target.presence,
    state,
    changes,
    ownCommits: integration?.ownCommits ?? null,
    notInBase: integration?.notInBase ?? null,
    notInOrigin: integration?.notInOrigin ?? null,
    baseBranch,
    error,
  };
}

async function inspect(repository: Repository, target: WorktreeTarget): Promise<WorktreeStatus> {
  if (target.presence === "prunable") {
    return describe(repository, target, {
      changes: NO_CHANGES,
      integration: null,
      baseBranch: null,
      error: null,
    });
  }
  const changes = target.presence === "present" ? await readChanges(target.path) : NO_CHANGES;
  const base = await resolveBase(repository, target);
  const integration = await readTargetIntegration(repository, target, base);
  return describe(repository, target, {
    changes,
    integration,
    baseBranch: base?.name ?? null,
    error: null,
  });
}

/** A failing git command marks only this worktree as unknown instead of failing the whole view. */
export async function readWorktreeStatus(
  repository: Repository,
  target: WorktreeTarget,
): Promise<WorktreeStatus> {
  try {
    return await inspect(repository, target);
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
    return describe(repository, target, {
      changes: NO_CHANGES,
      integration: null,
      baseBranch: repository.base?.name ?? null,
      error: error.message,
    });
  }
}
