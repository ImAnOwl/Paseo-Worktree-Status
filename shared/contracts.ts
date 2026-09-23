import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const WorktreeStateSchema = z.enum([
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
]);
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

export const ChangeCountsSchema = z.object({
  modified: z.number(),
  untracked: z.number(),
  conflicted: z.number(),
});
export type ChangeCounts = z.infer<typeof ChangeCountsSchema>;

export const WorktreeStatusSchema = z.object({
  path: z.string(),
  repositoryRoot: z.string(),
  repositoryName: z.string(),
  branch: z.string().nullable(),
  isMainCheckout: z.boolean(),
  presence: z.enum(["present", "prunable", "removed"]),
  state: WorktreeStateSchema,
  changes: ChangeCountsSchema,
  ownCommits: z.number().nullable(),
  notInBase: z.number().nullable(),
  notInOrigin: z.number().nullable(),
  baseBranch: z.string().nullable(),
  error: z.string().nullable(),
});
export type WorktreeStatus = z.infer<typeof WorktreeStatusSchema>;

export const RepositoryStatusSchema = z.object({
  root: z.string(),
  name: z.string(),
  baseBranch: z.string().nullable(),
  hasRemoteBase: z.boolean(),
  unpushedCommits: z.number().nullable(),
  mainChanges: ChangeCountsSchema,
});
export type RepositoryStatus = z.infer<typeof RepositoryStatusSchema>;

export const LinkSourceSchema = z.enum(["manual", "workspace", "agent", "timeline"]);
export type LinkSource = z.infer<typeof LinkSourceSchema>;

export const WorkspaceStatusSchema = z.object({
  workspaceId: z.string(),
  state: WorktreeStateSchema,
  linkSource: LinkSourceSchema.nullable(),
  isScanning: z.boolean(),
  worktrees: z.array(WorktreeStatusSchema),
  repositories: z.array(RepositoryStatusSchema),
  computedAt: z.string(),
});
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

export const OverviewRowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    workspaceId: z.string(),
    title: z.string(),
    state: WorktreeStateSchema,
    worktrees: z.array(WorktreeStatusSchema),
  }),
  z.object({ kind: z.literal("orphan"), worktree: WorktreeStatusSchema }),
]);
export type OverviewRow = z.infer<typeof OverviewRowSchema>;

export const OverviewSectionSchema = z.object({
  repository: RepositoryStatusSchema,
  rows: z.array(OverviewRowSchema),
});
export type OverviewSection = z.infer<typeof OverviewSectionSchema>;

export const UnlinkedTaskSchema = z.object({ workspaceId: z.string(), title: z.string() });
export type UnlinkedTask = z.infer<typeof UnlinkedTaskSchema>;

export const OverviewSchema = z.object({
  sections: z.array(OverviewSectionSchema),
  unlinked: z.array(UnlinkedTaskSchema),
  isScanning: z.boolean(),
  computedAt: z.string(),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const WorktreeCandidateSchema = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  repositoryName: z.string(),
  isMainCheckout: z.boolean(),
});
export type WorktreeCandidate = z.infer<typeof WorktreeCandidateSchema>;

/** Worktrees chosen by hand; null means the plugin links the task automatically. */
export const LinkOverrideSchema = z.array(z.string()).nullable();

export const workspaceStatusRpc = defineRpc({
  name: "status.workspace",
  input: z.object({ workspaceId: z.string(), override: LinkOverrideSchema }),
  output: WorkspaceStatusSchema,
});

export const overviewRpc = defineRpc({
  name: "status.overview",
  input: z.object({ overrides: z.record(z.string(), z.array(z.string())) }),
  output: OverviewSchema,
});

export const refreshRpc = defineRpc({
  name: "status.refresh",
  input: z.object({ workspaceId: z.string().nullable() }),
  output: z.object({ refreshedAt: z.string() }),
});

export const candidatesRpc = defineRpc({
  name: "worktrees.candidates",
  input: z.object({ workspaceId: z.string() }),
  output: z.object({ worktrees: z.array(WorktreeCandidateSchema) }),
});
