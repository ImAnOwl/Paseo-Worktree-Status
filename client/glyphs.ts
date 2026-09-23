import type { PluginTheme } from "@getpaseo/plugin";
import type { WorktreeState, WorktreeStatus } from "../shared/contracts";

export type GlyphTone = "strong" | "muted" | "tint" | "faint";

export interface Glyph {
  icon: string;
  tone: GlyphTone;
  label: string;
}

/** Monochrome by design; only "merged, not pushed" is tinted because it is the easiest to forget. */
export const GLYPHS: Record<WorktreeState, Glyph> = {
  dirty: { icon: "CircleDot", tone: "strong", label: "Uncommitted changes" },
  open: { icon: "GitPullRequestArrow", tone: "strong", label: "Not merged" },
  mergedLocal: { icon: "CircleArrowUp", tone: "tint", label: "Merged, main not pushed" },
  missing: { icon: "CircleAlert", tone: "muted", label: "Folder missing" },
  empty: { icon: "CircleDashed", tone: "muted", label: "No commits yet" },
  localOnly: { icon: "CloudOff", tone: "muted", label: "Committed, no remote" },
  done: { icon: "CircleCheck", tone: "muted", label: "Merged and pushed" },
  cleaned: { icon: "CheckCheck", tone: "muted", label: "Cleaned up" },
  unknown: { icon: "CircleHelp", tone: "faint", label: "Status unknown" },
  none: { icon: "GitBranch", tone: "faint", label: "No worktree linked" },
};

export const LEGEND_STATES: readonly WorktreeState[] = [
  "dirty",
  "open",
  "mergedLocal",
  "empty",
  "localOnly",
  "done",
  "cleaned",
];

export function toneColor(tone: GlyphTone, theme: PluginTheme, mutedColor: string): string {
  if (tone === "strong") return theme.colors.foreground;
  if (tone === "tint") return theme.colors.statusWarning;
  return mutedColor;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function describeWorktree(status: WorktreeStatus): string {
  const base = status.baseBranch ?? "main";
  const { modified, conflicted, untracked } = status.changes;
  const untrackedNote = untracked > 0 ? ` · ${plural(untracked, "untracked file")}` : "";
  switch (status.state) {
    case "dirty":
      return `${plural(modified + conflicted, "uncommitted change")}${untrackedNote}`;
    case "open":
      return `${plural(status.notInBase ?? 0, "commit")} not in ${base}`;
    case "mergedLocal":
      return status.isMainCheckout
        ? `${plural(status.notInOrigin ?? 0, "commit")} not on origin/${base}`
        : `In ${base}, not on origin/${base} yet`;
    case "missing":
      return "Folder was deleted, the worktree entry remains";
    case "empty":
      return `No commits since branching from ${base}`;
    case "localOnly":
      return status.isMainCheckout
        ? `All committed, no origin remote to push to${untrackedNote}`
        : `In ${base}, no origin remote to push to${untrackedNote}`;
    case "done":
      return `In origin/${base}${untrackedNote}`;
    case "cleaned":
      return "Worktree removed, work is merged";
    case "unknown":
      return status.error ?? "Could not read the git state";
    case "none":
      return "";
  }
}

export function worktreeName(status: WorktreeStatus): string {
  return status.isMainCheckout
    ? status.repositoryName
    : (status.path.split("/").pop() ?? status.path);
}

/** Local clock time; a relative age would only be recomputed on the next fetch. */
export function formatClockTime(isoTime: string): string {
  const time = new Date(isoTime);
  return [time.getHours(), time.getMinutes(), time.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
