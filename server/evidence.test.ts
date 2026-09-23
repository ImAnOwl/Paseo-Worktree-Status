import { describe, expect, it } from "vitest";
import type { EvidenceRoots, TimelineItem } from "./evidence";
import {
  collectEvidence,
  combineEvidence,
  mergeEvidence,
  selectLinks,
  splitCommands,
} from "./evidence";

const repo = "/work/app";
const feature = "/work/app/.worktrees/feature";
const other = "/work/app/.worktrees/other";
const roots: EvidenceRoots = {
  worktrees: [repo, feature, other],
  containers: ["/work/app/.worktrees"],
};
const mainCheckouts = new Set([repo]);

function shell(command: string, extra: { cwd?: string; output?: string } = {}): TimelineItem {
  return {
    type: "tool_call",
    callId: command,
    name: "Bash",
    status: "completed",
    error: null,
    detail: { type: "shell", command, ...extra },
  };
}

function edit(filePath: string): TimelineItem {
  return {
    type: "tool_call",
    callId: filePath,
    name: "Edit",
    status: "completed",
    error: null,
    detail: { type: "edit", filePath },
  };
}

function read(filePath: string): TimelineItem {
  return {
    type: "tool_call",
    callId: filePath,
    name: "Read",
    status: "completed",
    error: null,
    detail: { type: "read", filePath },
  };
}

function linksFor(items: TimelineItem[], scanRoots: EvidenceRoots = roots) {
  const evidence = collectEvidence({
    items,
    directory: "/work",
    home: "/home/me",
    roots: scanRoots,
  });
  return selectLinks(evidence, mainCheckouts);
}

describe("collectEvidence", () => {
  it("follows cd across shell calls and links the worktree an agent created", () => {
    const links = linksFor([
      shell("cd /work/app && git status"),
      shell("git worktree add -b feat/feature .worktrees/feature main"),
      shell("cd /work/app/.worktrees/feature && npm test"),
      edit("/work/app/.worktrees/feature/src/index.ts"),
    ]);
    expect(links.map((link) => link.path)).toEqual([feature]);
    expect(links[0].branch).toBe("feat/feature");
  });

  it("ignores worktrees that only appear in tool output", () => {
    const listing = `${repo} abc [main]\n${other} def [feat/other]`;
    const links = linksFor([shell("cd /work/app && git worktree list", { output: listing })]);
    expect(links.map((link) => link.path)).toEqual([repo]);
  });

  it("does not link a worktree from reads alone", () => {
    const links = linksFor([
      read("/work/app/.worktrees/other/a.ts"),
      read("/work/app/.worktrees/other/b.ts"),
      read("/work/app/.worktrees/other/c.ts"),
      read("/work/app/.worktrees/other/d.ts"),
    ]);
    expect(links).toEqual([]);
  });

  it("links a removed worktree through its container folder", () => {
    const withoutFeature: EvidenceRoots = { worktrees: [repo], containers: roots.containers };
    const links = linksFor([shell("cd /work/app/.worktrees/feature")], withoutFeature);
    expect(links.map((link) => link.path)).toEqual([feature]);
  });

  it("reads commands nested in bash -lc", () => {
    const links = linksFor([shell(`bash -lc "cd ${feature} && make"`)]);
    expect(links.map((link) => link.path)).toEqual([feature]);
  });

  it("uses the shell cwd reported by providers without persistent shells", () => {
    const links = linksFor([shell("make", { cwd: feature }), shell("make test", { cwd: feature })]);
    expect(links.map((link) => link.path)).toEqual([feature]);
  });

  it("skips heredoc bodies", () => {
    const script = `cat > notes.sh <<'EOF'\ncd ${other}\nEOF`;
    expect(linksFor([shell(script)])).toEqual([]);
  });

  it("links a git -C commit in a worktree", () => {
    const links = linksFor([
      shell(`git -C ${feature} add -A`),
      shell(`git -C ${feature} commit -m x`),
    ]);
    expect(links.map((link) => link.path)).toEqual([feature]);
  });
});

describe("splitCommands", () => {
  it("splits on shell operators and keeps quoted words together", () => {
    expect(splitCommands(`cd "a b" && git commit -m 'x; y' | cat`)).toEqual([
      ["cd", "a b"],
      ["git", "commit", "-m", "x; y"],
      ["cat"],
    ]);
  });
});

describe("mergeEvidence", () => {
  it("keeps the stronger reading instead of adding up rescans", () => {
    const first = { [feature]: { score: 7, isStrong: true, branch: null } };
    const again = { [feature]: { score: 7, isStrong: true, branch: "feat/feature" } };
    expect(mergeEvidence(first, again)).toEqual({
      [feature]: { score: 7, isStrong: true, branch: "feat/feature" },
    });
  });
});

describe("combineEvidence", () => {
  it("adds up evidence from several agents", () => {
    const one = { [feature]: { score: 2, isStrong: true, branch: null } };
    const two = { [feature]: { score: 2, isStrong: false, branch: null } };
    const links = selectLinks(combineEvidence([one, two]), mainCheckouts);
    expect(links).toEqual([{ path: feature, score: 4, branch: null }]);
  });
});
