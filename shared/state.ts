import type { ChangeCounts, WorktreeState } from "./contracts";

export interface IntegrationFacts {
  /** Commits on the tip that are not reachable from the local base branch. */
  ownCommits: number;
  /** Own commits whose patch is not in the local base branch either. */
  notInBase: number;
  /** Commits whose patch is not on the remote base branch; null without a remote base. */
  notInOrigin: number | null;
  /** Whether the branch reflog shows any commit, or null when there is no reflog. */
  hasWorked: boolean | null;
  isBaseBranch: boolean;
}

export interface WorktreeFacts {
  presence: "present" | "prunable" | "removed";
  changes: ChangeCounts;
  integration: IntegrationFacts | null;
}

export const STATE_PRIORITY: readonly WorktreeState[] = [
  "dirty",
  "open",
  "mergedLocal",
  "missing",
  "empty",
  "localOnly",
  "done",
  "cleaned",
  "unknown",
  "none",
];

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** Parses `git status --porcelain=v1 -z`. */
export function parsePorcelain(output: string): ChangeCounts {
  const counts = { modified: 0, untracked: 0, conflicted: 0 };
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    // Renames and copies carry their source path as the next entry.
    if (code[0] === "R" || code[0] === "C") index += 1;
    if (code === "??") counts.untracked += 1;
    else if (CONFLICT_CODES.has(code)) counts.conflicted += 1;
    else if (code !== "!!") counts.modified += 1;
  }
  return counts;
}

export function deriveState({ presence, changes, integration }: WorktreeFacts): WorktreeState {
  if (presence === "prunable") return "missing";
  const isRemoved = presence === "removed";
  const hasTrackedChanges = changes.modified + changes.conflicted > 0;
  if (!isRemoved && hasTrackedChanges) return "dirty";
  if (integration === null) return isRemoved ? "cleaned" : "unknown";
  return deriveIntegrationState(integration, isRemoved);
}

function deriveIntegrationState(facts: IntegrationFacts, isRemoved: boolean): WorktreeState {
  const isInOrigin = facts.notInOrigin === 0;
  if (facts.notInBase > 0 && !isInOrigin) return "open";
  // Checked before "mergedLocal": a fresh branch cut from an unpushed main contains unpushed commits.
  const isUntouched = facts.ownCommits === 0 && facts.hasWorked === false && !facts.isBaseBranch;
  if (isUntouched) return isRemoved ? "cleaned" : "empty";
  // Without a remote base nothing can be called pushed, however complete the local history is.
  if (facts.notInOrigin === null) return isRemoved ? "cleaned" : "localOnly";
  if (facts.notInOrigin > 0) return "mergedLocal";
  return isRemoved ? "cleaned" : "done";
}

export function compareStates(left: WorktreeState, right: WorktreeState): number {
  return STATE_PRIORITY.indexOf(left) - STATE_PRIORITY.indexOf(right);
}

/** The most urgent state wins, so one icon can stand for several worktrees. */
export function aggregateStates(states: readonly WorktreeState[]): WorktreeState {
  return states.reduce<WorktreeState>(
    (worst, state) => (compareStates(state, worst) < 0 ? state : worst),
    "none",
  );
}
