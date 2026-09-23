import { describe, expect, it } from "vitest";
import type { Repository } from "./repository";
import type { LinkQuery } from "./tasks";
import { resolveLinks, resolveTarget } from "./tasks";

const root = "/work/app";
const feature = "/work/app/.worktrees/feature";

const repository: Repository = {
  root,
  name: "app",
  worktrees: [
    { path: root, head: "a", branch: "main", isMain: true, isPrunable: false },
    { path: feature, head: "b", branch: "feat/feature", isMain: false, isPrunable: false },
  ],
  refs: new Map([
    ["refs/heads/main", "a"],
    ["refs/heads/feat/feature", "b"],
    ["refs/heads/fix/gone", "c"],
  ]),
  base: { name: "main", localSha: "a", remoteSha: "a" },
  unpushedCommits: 0,
  containers: ["/work/app/.worktrees"],
};

function query(overrides: Partial<LinkQuery>): LinkQuery {
  return {
    task: { id: "task", title: "Task", directory: "/work" },
    repositories: [repository],
    agents: [],
    override: undefined,
    evidence: {},
    ...overrides,
  };
}

describe("resolveLinks", () => {
  it("prefers a manual link over everything else", () => {
    const links = resolveLinks(
      query({
        override: [root],
        evidence: { [feature]: { score: 9, isStrong: true, branch: null } },
      }),
    );
    expect(links).toEqual([{ path: root, source: "manual", branch: null }]);
  });

  it("treats an empty manual list as no worktree", () => {
    expect(resolveLinks(query({ override: [] }))).toEqual([]);
  });

  it("links a task that lives inside a worktree", () => {
    const links = resolveLinks(query({ task: { id: "task", title: "Task", directory: feature } }));
    expect(links).toEqual([{ path: feature, source: "workspace", branch: null }]);
  });

  it("links the worktree an agent was started in", () => {
    const agents = [{ id: "a", workspaceId: "task", cwd: `${feature}/src`, isClosed: false }];
    expect(resolveLinks(query({ agents }))).toEqual([
      { path: feature, source: "agent", branch: null },
    ]);
  });

  it("falls back to timeline evidence", () => {
    const evidence = { [feature]: { score: 8, isStrong: true, branch: "feat/feature" } };
    expect(resolveLinks(query({ evidence }))).toEqual([
      { path: feature, source: "timeline", branch: "feat/feature" },
    ]);
  });

  it("links the main checkout when the task is the checkout itself", () => {
    const links = resolveLinks(query({ task: { id: "task", title: "Task", directory: root } }));
    expect(links).toEqual([{ path: root, source: "workspace", branch: null }]);
  });

  it("links nothing for a folder without git work", () => {
    expect(resolveLinks(query({}))).toEqual([]);
  });
});

describe("resolveTarget", () => {
  it("finds the branch a removed worktree left behind by its folder name", () => {
    const resolved = resolveTarget(
      { path: "/work/app/.worktrees/gone", source: "timeline", branch: null },
      [repository],
    );
    expect(resolved?.target).toEqual({
      path: "/work/app/.worktrees/gone",
      branch: "fix/gone",
      tip: "c",
      presence: "removed",
      isMainCheckout: false,
    });
  });

  it("returns null for a folder outside every repository", () => {
    expect(
      resolveTarget({ path: "/elsewhere", source: "manual", branch: null }, [repository]),
    ).toBe(null);
  });
});
