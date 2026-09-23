import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorktreeStatus } from "../shared/contracts";
import { discoverRepositories } from "./discovery";
import type { WorktreeTarget } from "./facts";
import { readWorktreeStatus } from "./facts";
import type { Repository } from "./repository";
import { readRepository } from "./repository";

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

let sandbox: string;
let root: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...GIT_IDENTITY },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commitFile(cwd: string, name: string): void {
  writeFileSync(path.join(cwd, name), `${name}\n`);
  git(cwd, "add", name);
  git(cwd, "commit", "-q", "-m", `add ${name}`);
}

function addWorktree(name: string): string {
  const worktreePath = path.join(root, ".worktrees", name);
  git(root, "worktree", "add", "-q", "-b", `feat/${name}`, worktreePath, "main");
  return worktreePath;
}

function presentTarget(repository: Repository, name: string): WorktreeTarget {
  const worktreePath = path.join(root, ".worktrees", name);
  const entry = repository.worktrees.find((worktree) => worktree.path === worktreePath);
  if (entry === undefined) throw new Error(`worktree ${name} is not listed`);
  return {
    path: entry.path,
    branch: entry.branch,
    tip: entry.head,
    presence: entry.isPrunable ? "prunable" : "present",
    isMainCheckout: false,
  };
}

async function statusOf(name: string): Promise<WorktreeStatus> {
  const repository = await readRepository(root);
  return readWorktreeStatus(repository, presentTarget(repository, name));
}

beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(path.join(os.tmpdir(), "worktree-status-")));
  const origin = path.join(sandbox, "origin.git");
  root = path.join(sandbox, "projects", "app");
  git(sandbox, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(path.dirname(root), { recursive: true });
  git(sandbox, "clone", "-q", origin, root);
  commitFile(root, "readme.md");
  git(root, "push", "-q", "-u", "origin", "main");
  git(root, "remote", "set-head", "origin", "main");

  addWorktree("empty");

  const dirty = addWorktree("dirty");
  commitFile(dirty, "dirty.txt");
  writeFileSync(path.join(dirty, "dirty.txt"), "changed\n");

  const untracked = addWorktree("untracked");
  commitFile(untracked, "untracked.txt");
  git(root, "merge", "-q", "--no-ff", "-m", "merge untracked", "feat/untracked");
  writeFileSync(path.join(untracked, "notes.txt"), "scratch\n");

  const open = addWorktree("open");
  commitFile(open, "open.txt");

  const picked = addWorktree("picked");
  commitFile(picked, "picked.txt");
  // Diverge first; otherwise the picked commit can come out byte-identical to the original.
  commitFile(root, "main-only.txt");
  git(root, "cherry-pick", "feat/picked");

  const pushed = addWorktree("pushed");
  commitFile(pushed, "pushed.txt");
  git(root, "merge", "-q", "--no-ff", "-m", "merge pushed", "feat/pushed");
  git(root, "push", "-q", "origin", "main");

  const local = addWorktree("local");
  commitFile(local, "local.txt");
  git(root, "merge", "-q", "--no-ff", "-m", "merge local", "feat/local");

  const gone = addWorktree("gone");
  rmSync(gone, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("readWorktreeStatus", () => {
  it("reports a branch without commits as empty", async () => {
    expect((await statusOf("empty")).state).toBe("empty");
  });

  it("reports tracked changes as dirty", async () => {
    const status = await statusOf("dirty");
    expect(status.state).toBe("dirty");
    expect(status.changes.modified).toBe(1);
  });

  it("keeps untracked files as a side note", async () => {
    const status = await statusOf("untracked");
    expect(status.state).toBe("done");
    expect(status.changes.untracked).toBe(1);
  });

  it("reports commits missing from main as open", async () => {
    const status = await statusOf("open");
    expect(status.state).toBe("open");
    expect(status.notInBase).toBe(1);
  });

  it("recognizes cherry-picked commits as merged and pushed", async () => {
    const status = await statusOf("picked");
    expect(status.state).toBe("done");
    expect(status.ownCommits).toBe(1);
    expect(status.notInOrigin).toBe(0);
  });

  it("reports a merged and pushed branch as done", async () => {
    expect((await statusOf("pushed")).state).toBe("done");
  });

  it("reports a branch merged into an unpushed main", async () => {
    const status = await statusOf("local");
    expect(status.state).toBe("mergedLocal");
    expect(status.baseBranch).toBe("main");
  });

  it("reports a deleted worktree folder as missing", async () => {
    expect((await statusOf("gone")).state).toBe("missing");
  });

  it("reports a removed worktree with an unmerged branch as open", async () => {
    const repository = await readRepository(root);
    const branchTip = repository.refs.get("refs/heads/feat/open") ?? null;
    const status = await readWorktreeStatus(repository, {
      path: path.join(root, ".worktrees", "removed"),
      branch: "feat/open",
      tip: branchTip,
      presence: "removed",
      isMainCheckout: false,
    });
    expect(status.state).toBe("open");
  });

  it("reports the unpushed main checkout as merged locally", async () => {
    const repository = await readRepository(root);
    const status = await readWorktreeStatus(repository, {
      path: root,
      branch: "main",
      tip: repository.base?.localSha ?? null,
      presence: "present",
      isMainCheckout: true,
    });
    expect(status.state).toBe("mergedLocal");
    expect(repository.unpushedCommits).toBe(2);
  });
});

describe("readRepository", () => {
  it("detects main from origin/HEAD and lists the worktree container", async () => {
    const repository = await readRepository(root);
    expect(repository.base?.name).toBe("main");
    expect(repository.containers).toEqual([path.join(root, ".worktrees")]);
  });
});

describe("discoverRepositories", () => {
  it("finds a repository below a plain workspace folder", async () => {
    expect(await discoverRepositories(path.dirname(root))).toEqual([root]);
  });

  it("resolves a linked worktree to its main repository", async () => {
    expect(await discoverRepositories(path.join(root, ".worktrees", "open"))).toEqual([root]);
  });
});
