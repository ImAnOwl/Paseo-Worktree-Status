import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { WorktreeStatus } from "../shared/contracts";
import type { Evidence } from "./evidence";
import { selectLinks } from "./evidence";
import type { WorktreeTarget } from "./facts";
import type { Repository } from "./repository";

export type Paseo = PluginHandlerContext["paseo"];

export interface Task {
  id: string;
  title: string;
  directory: string;
}

export interface TaskAgent {
  id: string;
  workspaceId: string | null;
  cwd: string;
  isClosed: boolean;
}

export interface Link {
  path: string;
  branch: string | null;
}

export interface LinkQuery {
  task: Task;
  repositories: readonly Repository[];
  agents: readonly TaskAgent[];
  evidence: Evidence;
}

export interface ResolvedTarget {
  repository: Repository;
  target: WorktreeTarget;
}

const PAGE_LIMIT = 200;
const BRANCH_PREFIX = "refs/heads/";

export async function loadTasks(paseo: Paseo): Promise<Task[]> {
  const tasks: Task[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces.list({ page: { limit: PAGE_LIMIT, cursor } });
    for (const workspace of page.entries) {
      tasks.push({
        id: workspace.id,
        title: workspace.name,
        directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
      });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return tasks;
}

export async function loadAgents(paseo: Paseo): Promise<TaskAgent[]> {
  const agents: TaskAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: { includeArchived: false },
      page: { limit: PAGE_LIMIT, cursor },
    });
    for (const { agent } of page.entries) {
      agents.push({
        id: agent.id,
        workspaceId: agent.workspaceId ?? null,
        cwd: agent.cwd,
        isClosed: agent.status === "closed",
      });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return agents;
}

function isInside(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function findContaining(target: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  for (const candidate of candidates) {
    const isBetter = best === null || candidate.length > best.length;
    if (isInside(target, candidate) && isBetter) best = candidate;
  }
  return best;
}

function toLinks(paths: readonly string[]): Link[] {
  return [...new Set(paths)].map((worktree) => ({ path: worktree, branch: null }));
}

/**
 * Direct facts beat inference: a task that is itself a worktree, then agents started inside one,
 * then timeline evidence, and the main checkout only as a last resort.
 */
export function resolveLinks({ task, repositories, agents, evidence }: LinkQuery): Link[] {
  const entries = repositories.flatMap((repository) => repository.worktrees);
  const linkedWorktrees = entries.filter((entry) => !entry.isMain).map((entry) => entry.path);
  const mainCheckouts = new Set(entries.filter((entry) => entry.isMain).map((entry) => entry.path));

  const ownWorktree = findContaining(task.directory, linkedWorktrees);
  if (ownWorktree !== null) return toLinks([ownWorktree]);

  const agentWorktrees = agents
    .map((agent) => findContaining(agent.cwd, linkedWorktrees))
    .filter((worktree) => worktree !== null);
  if (agentWorktrees.length > 0) return toLinks(agentWorktrees);

  const timelineLinks = selectLinks(evidence, mainCheckouts);
  if (timelineLinks.length > 0) {
    return timelineLinks.map((link) => ({
      path: link.path,
      branch: link.branch,
    }));
  }

  const mainCheckout = findContaining(task.directory, mainCheckouts);
  return mainCheckout === null ? [] : toLinks([mainCheckout]);
}

function findBranchForSlug(repository: Repository, slug: string): string | null {
  for (const ref of repository.refs.keys()) {
    if (!ref.startsWith(BRANCH_PREFIX)) continue;
    const branch = ref.slice(BRANCH_PREFIX.length);
    if (branch === slug || branch.endsWith(`/${slug}`)) return branch;
  }
  return null;
}

function removedTarget(repository: Repository, link: Link): WorktreeTarget {
  const hinted = link.branch ?? findBranchForSlug(repository, path.basename(link.path));
  const tip = hinted === null ? null : (repository.refs.get(BRANCH_PREFIX + hinted) ?? null);
  return {
    path: link.path,
    branch: tip === null ? null : hinted,
    tip,
    presence: "removed",
    isMainCheckout: false,
  };
}

export function targetFromEntry(entry: Repository["worktrees"][number]): WorktreeTarget {
  return {
    path: entry.path,
    branch: entry.branch,
    tip: entry.head,
    presence: entry.isPrunable ? "prunable" : "present",
    isMainCheckout: entry.isMain,
  };
}

/** A linked path that is no longer a worktree is judged by the branch it left behind. */
export function resolveTarget(
  link: Link,
  repositories: readonly Repository[],
): ResolvedTarget | null {
  for (const repository of repositories) {
    const entry = repository.worktrees.find((worktree) => worktree.path === link.path);
    if (entry !== undefined) return { repository, target: targetFromEntry(entry) };
  }
  const repository = repositories.find((candidate) => isInside(link.path, candidate.root));
  return repository === undefined ? null : { repository, target: removedTarget(repository, link) };
}

export function unresolvedStatus(worktreePath: string): WorktreeStatus {
  return {
    path: worktreePath,
    repositoryRoot: path.dirname(worktreePath),
    repositoryName: path.basename(path.dirname(worktreePath)),
    branch: null,
    isMainCheckout: false,
    presence: "removed",
    state: "unknown",
    changes: { modified: 0, untracked: 0, conflicted: 0 },
    ownCommits: null,
    notInBase: null,
    notInOrigin: null,
    baseBranch: null,
    error: "This folder is not inside a repository of this workspace",
  };
}
