import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type {
  Overview,
  OverviewRow,
  OverviewSection,
  RepositoryStatus,
  WorkspaceStatus,
  WorktreeStatus,
} from "../shared/contracts";
import { aggregateStates, compareStates } from "../shared/state";
import { discoverRepositories } from "./discovery";
import type { EvidenceRoots, TimelineItem } from "./evidence";
import { collectEvidence, combineEvidence } from "./evidence";
import { readChanges, readWorktreeStatus } from "./facts";
import type { LinkCache } from "./link-cache";
import { createMemo } from "./memo";
import type { Repository } from "./repository";
import { readRepository } from "./repository";
import type { Link, Paseo, Task, TaskAgent } from "./tasks";
import {
  loadAgents,
  loadTasks,
  resolveLinks,
  resolveTarget,
  targetFromEntry,
  unresolvedStatus,
} from "./tasks";

const LIST_TTL_MS = 10_000;
const DISCOVERY_TTL_MS = 5 * 60_000;
const REPOSITORY_TTL_MS = 4_000;
const TIMELINE_PAGE_SIZE = 500;
const MAX_TIMELINE_PAGES = 4;
const NO_CHANGES = { modified: 0, untracked: 0, conflicted: 0 };

type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];

export interface StatusServiceOptions {
  cache: LinkCache;
  home: string;
}

export interface StatusService {
  workspaceStatus(paseo: Paseo, workspaceId: string): Promise<WorkspaceStatus>;
  overview(paseo: Paseo): Promise<Overview>;
  refresh(paseo: Paseo, workspaceId: string | null): Promise<{ refreshedAt: string }>;
  onTurnEnded(paseo: Paseo, event: TurnEnded): Promise<void>;
  onWorkspaceArchived(): void;
  dispose(): Promise<void>;
}

interface TaskView {
  task: Task;
  agents: TaskAgent[];
  repositories: Repository[];
  links: Link[];
}

function evidenceRoots(repositories: readonly Repository[]): EvidenceRoots {
  return {
    worktrees: repositories.flatMap((repository) =>
      repository.worktrees.map((entry) => entry.path),
    ),
    containers: repositories.flatMap((repository) => repository.containers),
  };
}

async function readTimeline(paseo: Paseo, agentId: string): Promise<TimelineItem[]> {
  const handle = paseo.agents.ref(agentId);
  const pages: TimelineItem[][] = [];
  let page = await handle.timeline.refetch({ direction: "tail", limit: TIMELINE_PAGE_SIZE });
  pages.unshift(page.entries.map((entry) => entry.item));
  while (page.hasOlder && page.startCursor !== null && pages.length < MAX_TIMELINE_PAGES) {
    page = await handle.timeline.refetch({
      direction: "before",
      cursor: page.startCursor,
      limit: TIMELINE_PAGE_SIZE,
    });
    pages.unshift(page.entries.map((entry) => entry.item));
  }
  return pages.flat();
}

function sortRows(rows: OverviewRow[]): OverviewRow[] {
  const stateOf = (row: OverviewRow) => (row.kind === "task" ? row.state : row.worktree.state);
  const isOrphan = (row: OverviewRow) => (row.kind === "orphan" ? 1 : 0);
  return rows.sort(
    (left, right) =>
      isOrphan(left) - isOrphan(right) || compareStates(stateOf(left), stateOf(right)),
  );
}

export function createStatusService({ cache, home }: StatusServiceOptions): StatusService {
  const taskMemo = createMemo<Task[]>(LIST_TTL_MS);
  const agentMemo = createMemo<TaskAgent[]>(LIST_TTL_MS);
  const discoveryMemo = createMemo<string[]>(DISCOVERY_TTL_MS);
  const repositoryMemo = createMemo<Repository>(REPOSITORY_TTL_MS);
  const repositoryStatusMemo = createMemo<RepositoryStatus>(REPOSITORY_TTL_MS);
  const scannedAgents = new Set<string>();
  const scanningTasks = new Set<string>();
  let backfillQueue: Promise<void> = Promise.resolve();

  async function repositoriesIn(directory: string): Promise<Repository[]> {
    const roots = await discoveryMemo.get(directory, () => discoverRepositories(directory));
    return Promise.all(roots.map((root) => repositoryMemo.get(root, () => readRepository(root))));
  }

  function describeRepository(repository: Repository): Promise<RepositoryStatus> {
    return repositoryStatusMemo.get(repository.root, async () => {
      const hasMainCheckout = repository.worktrees.some((entry) => entry.isMain);
      return {
        root: repository.root,
        name: repository.name,
        baseBranch: repository.base?.name ?? null,
        hasRemoteBase: repository.base?.remoteSha != null,
        unpushedCommits: repository.unpushedCommits,
        mainChanges: hasMainCheckout ? await readChanges(repository.root) : NO_CHANGES,
      };
    });
  }

  async function viewTask(task: Task, agents: readonly TaskAgent[]): Promise<TaskView> {
    const repositories = await repositoriesIn(task.directory);
    const taskAgents = agents.filter((agent) => agent.workspaceId === task.id);
    const evidence = combineEvidence(cache.evidenceFor(task.id));
    const links = resolveLinks({ task, repositories, agents: taskAgents, evidence });
    return { task, agents: taskAgents, repositories, links };
  }

  async function findTask(paseo: Paseo, workspaceId: string): Promise<Task | null> {
    const known = await taskMemo.get("all", () => loadTasks(paseo));
    const task = known.find((candidate) => candidate.id === workspaceId);
    if (task !== undefined) return task;
    // A task created moments ago is not in the cached list yet.
    taskMemo.clear();
    const fresh = await taskMemo.get("all", () => loadTasks(paseo));
    return fresh.find((candidate) => candidate.id === workspaceId) ?? null;
  }

  async function backfill(
    paseo: Paseo,
    view: TaskView,
    agents: readonly TaskAgent[],
  ): Promise<void> {
    const roots = evidenceRoots(view.repositories);
    for (const agent of agents) {
      try {
        const items = await readTimeline(paseo, agent.id);
        const evidence = collectEvidence({ items, directory: agent.cwd, home, roots });
        cache.update(agent.id, view.task.id, evidence);
      } catch (error) {
        console.error(`[worktree-status] could not read the timeline of agent ${agent.id}`, error);
      }
    }
  }

  /**
   * Reading a closed agent's timeline would resume its session, so only live agents are read.
   * Returns whether the task is still being scanned, so callers poll again soon.
   */
  function scheduleBackfill(paseo: Paseo, view: TaskView): boolean {
    const pending = view.agents.filter((agent) => !agent.isClosed && !scannedAgents.has(agent.id));
    if (pending.length === 0) return scanningTasks.has(view.task.id);
    for (const agent of pending) scannedAgents.add(agent.id);
    scanningTasks.add(view.task.id);
    backfillQueue = backfillQueue
      .then(() => backfill(paseo, view, pending))
      .finally(() => scanningTasks.delete(view.task.id));
    return true;
  }

  function statusForLink(link: Link, repositories: readonly Repository[]): Promise<WorktreeStatus> {
    const resolved = resolveTarget(link, repositories);
    if (resolved === null) return Promise.resolve(unresolvedStatus(link.path));
    return readWorktreeStatus(resolved.repository, resolved.target);
  }

  async function buildSection(
    repository: Repository,
    views: readonly TaskView[],
  ): Promise<OverviewSection> {
    const worktrees = repository.worktrees.filter((entry) => !entry.isMain);
    const statuses = await Promise.all(
      worktrees.map((entry) => readWorktreeStatus(repository, targetFromEntry(entry))),
    );
    const statusByPath = new Map(statuses.map((status) => [status.path, status]));
    const linkedPaths = new Set<string>();
    const rows: OverviewRow[] = [];
    for (const view of views) {
      const links = view.links.filter((link) => resolveTarget(link, [repository]) !== null);
      if (links.length === 0) continue;
      const linked = await Promise.all(
        links.map((link) => statusByPath.get(link.path) ?? statusForLink(link, [repository])),
      );
      for (const link of links) linkedPaths.add(link.path);
      const state = aggregateStates(linked.map((status) => status.state));
      rows.push({
        kind: "task",
        workspaceId: view.task.id,
        title: view.task.title,
        state,
        worktrees: linked,
      });
    }
    for (const status of statuses) {
      if (!linkedPaths.has(status.path)) rows.push({ kind: "orphan", worktree: status });
    }
    return { repository: await describeRepository(repository), rows: sortRows(rows) };
  }

  function isWorthShowing(section: OverviewSection): boolean {
    return section.rows.length > 0 || (section.repository.unpushedCommits ?? 0) > 0;
  }

  async function allViews(paseo: Paseo): Promise<TaskView[]> {
    const [tasks, agents] = await Promise.all([
      taskMemo.get("all", () => loadTasks(paseo)),
      agentMemo.get("all", () => loadAgents(paseo)),
    ]);
    return Promise.all(tasks.map((task) => viewTask(task, agents)));
  }

  function clearGitCaches(): void {
    discoveryMemo.clear();
    repositoryMemo.clear();
    repositoryStatusMemo.clear();
  }

  return {
    async workspaceStatus(paseo, workspaceId) {
      const computedAt = new Date().toISOString();
      const task = await findTask(paseo, workspaceId);
      if (task === null) {
        return {
          workspaceId,
          state: "none",
          isScanning: false,
          worktrees: [],
          repositories: [],
          computedAt,
        };
      }
      const agents = await agentMemo.get("all", () => loadAgents(paseo));
      const view = await viewTask(task, agents);
      const isScanning = scheduleBackfill(paseo, view);
      const worktrees = await Promise.all(
        view.links.map((link) => statusForLink(link, view.repositories)),
      );
      const linkedRoots = new Set(worktrees.map((status) => status.repositoryRoot));
      const repositories = await Promise.all(
        view.repositories
          .filter((repository) => linkedRoots.has(repository.root))
          .map(describeRepository),
      );
      return {
        workspaceId,
        state: aggregateStates(worktrees.map((status) => status.state)),
        isScanning,
        worktrees,
        repositories,
        computedAt,
      };
    },

    async overview(paseo) {
      const computedAt = new Date().toISOString();
      const views = await allViews(paseo);
      const scanning = views.map((view) => scheduleBackfill(paseo, view));
      const repositories = new Map(
        views
          .flatMap((view) => view.repositories)
          .map((repository) => [repository.root, repository]),
      );
      const sections = await Promise.all(
        [...repositories.values()].map((repository) => buildSection(repository, views)),
      );
      const unlinked = views
        .filter((view) => view.links.length === 0 && view.repositories.length > 0)
        .map((view) => ({ workspaceId: view.task.id, title: view.task.title }));
      return {
        sections: sections.filter(isWorthShowing),
        unlinked,
        isScanning: scanning.includes(true),
        computedAt,
      };
    },

    async refresh(paseo, workspaceId) {
      clearGitCaches();
      taskMemo.clear();
      agentMemo.clear();
      if (workspaceId !== null) {
        const agents = await agentMemo.get("all", () => loadAgents(paseo));
        for (const agent of agents) {
          if (agent.workspaceId === workspaceId) scannedAgents.delete(agent.id);
        }
      }
      return { refreshedAt: new Date().toISOString() };
    },

    async onTurnEnded(paseo, { agent, timeline }) {
      if (agent.workspaceId === null) return;
      const task = await findTask(paseo, agent.workspaceId);
      const directory = task?.directory ?? agent.cwd;
      // The turn may have created a worktree, so the repository is read again.
      const roots = await discoveryMemo.get(directory, () => discoverRepositories(directory));
      for (const root of roots) {
        repositoryMemo.delete(root);
        repositoryStatusMemo.delete(root);
      }
      const repositories = await repositoriesIn(directory);
      const evidence = collectEvidence({
        items: timeline,
        directory: agent.cwd,
        home,
        roots: evidenceRoots(repositories),
      });
      cache.update(agent.id, agent.workspaceId, evidence);
      scannedAgents.add(agent.id);
    },

    onWorkspaceArchived() {
      taskMemo.clear();
    },

    async dispose() {
      await cache.flush();
    },
  };
}
