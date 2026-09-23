import { describe, expect, it } from "vitest";
import type { IntegrationFacts, WorktreeFacts } from "./state";
import { aggregateStates, deriveState, parsePorcelain } from "./state";

const clean = { modified: 0, untracked: 0, conflicted: 0 };

function integration(overrides: Partial<IntegrationFacts>): IntegrationFacts {
  return {
    ownCommits: 0,
    notInBase: 0,
    notInOrigin: 0,
    hasWorked: true,
    isBaseBranch: false,
    ...overrides,
  };
}

function facts(overrides: Partial<WorktreeFacts>): WorktreeFacts {
  return { presence: "present", changes: clean, integration: integration({}), ...overrides };
}

describe("parsePorcelain", () => {
  it("counts modified, untracked and conflicted entries", () => {
    const output = [" M a.ts", "M  b.ts", "?? c.ts", "UU d.ts", "R  new.ts", "old.ts", ""].join(
      "\0",
    );
    expect(parsePorcelain(output)).toEqual({ modified: 3, untracked: 1, conflicted: 1 });
  });

  it("returns zero counts for a clean tree", () => {
    expect(parsePorcelain("")).toEqual(clean);
  });
});

describe("deriveState", () => {
  it("reports tracked changes as dirty", () => {
    expect(deriveState(facts({ changes: { ...clean, modified: 2 } }))).toBe("dirty");
  });

  it("treats untracked files alone as clean", () => {
    expect(deriveState(facts({ changes: { ...clean, untracked: 2 } }))).toBe("done");
  });

  it("reports commits missing from main as open", () => {
    const state = deriveState(
      facts({ integration: integration({ ownCommits: 3, notInBase: 3, notInOrigin: 3 }) }),
    );
    expect(state).toBe("open");
  });

  it("counts cherry-picked commits as merged", () => {
    const state = deriveState(
      facts({ integration: integration({ ownCommits: 2, notInBase: 0, notInOrigin: 0 }) }),
    );
    expect(state).toBe("done");
  });

  it("reports commits merged locally but not pushed", () => {
    const state = deriveState(
      facts({ integration: integration({ ownCommits: 0, notInBase: 0, notInOrigin: 4 }) }),
    );
    expect(state).toBe("mergedLocal");
  });

  it("treats a branch merged on the remote as done while local main lags behind", () => {
    const state = deriveState(
      facts({ integration: integration({ ownCommits: 2, notInBase: 2, notInOrigin: 0 }) }),
    );
    expect(state).toBe("done");
  });

  it("reports a branch without any work as empty, even when cut from an unpushed main", () => {
    const state = deriveState(
      facts({ integration: integration({ hasWorked: false, notInOrigin: 6 }) }),
    );
    expect(state).toBe("empty");
  });

  it("keeps an open branch open when there is no remote", () => {
    const state = deriveState(
      facts({ integration: integration({ ownCommits: 1, notInBase: 1, notInOrigin: null }) }),
    );
    expect(state).toBe("open");
  });

  it("reports an unpushed main checkout as merged locally", () => {
    const state = deriveState(
      facts({ integration: integration({ isBaseBranch: true, hasWorked: null, notInOrigin: 6 }) }),
    );
    expect(state).toBe("mergedLocal");
  });

  it("reports a missing worktree folder", () => {
    expect(deriveState(facts({ presence: "prunable" }))).toBe("missing");
  });

  it("reports a removed worktree with an integrated branch as cleaned", () => {
    expect(deriveState(facts({ presence: "removed" }))).toBe("cleaned");
  });

  it("keeps a removed worktree with unmerged commits open", () => {
    const state = deriveState(
      facts({
        presence: "removed",
        integration: integration({ ownCommits: 1, notInBase: 1, notInOrigin: 1 }),
      }),
    );
    expect(state).toBe("open");
  });

  it("reports a removed worktree without a branch as cleaned", () => {
    expect(deriveState(facts({ presence: "removed", integration: null }))).toBe("cleaned");
  });

  it("reports a present worktree without integration facts as unknown", () => {
    expect(deriveState(facts({ integration: null }))).toBe("unknown");
  });
});

describe("aggregateStates", () => {
  it("picks the most urgent state", () => {
    expect(aggregateStates(["done", "mergedLocal", "empty"])).toBe("mergedLocal");
  });

  it("returns none without worktrees", () => {
    expect(aggregateStates([])).toBe("none");
  });
});
