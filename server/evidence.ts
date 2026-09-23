import path from "node:path";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

export type TimelineItem = PluginLifecycleEvents["agent.turn_ended"]["timeline"][number];

export interface EvidenceScore {
  score: number;
  /** Only deliberate actions (cd, edits, worktree creation) can link a worktree on their own. */
  isStrong: boolean;
  branch: string | null;
}

/** Scores keyed by worktree path. */
export type Evidence = Record<string, EvidenceScore>;

export interface EvidenceRoots {
  worktrees: readonly string[];
  /** Folders inside a repository that hold worktrees; paths below them survive worktree removal. */
  containers: readonly string[];
}

export interface EvidenceScan {
  items: readonly TimelineItem[];
  directory: string;
  home: string;
  roots: EvidenceRoots;
}

export interface LinkedWorktree {
  path: string;
  score: number;
  branch: string | null;
}

const MIN_LINK_SCORE = 4;
const WEIGHT = {
  worktreeSetup: 10,
  worktreeAdd: 8,
  cd: 4,
  edit: 3,
  shellCwd: 2,
  gitDirectory: 2,
  userMention: 2,
  read: 1,
  mention: 1,
} as const;
const SHELLS = new Set(["bash", "sh", "zsh"]);
const MUTATING_GIT = new Set([
  "add",
  "am",
  "apply",
  "checkout",
  "cherry-pick",
  "commit",
  "merge",
  "pull",
  "push",
  "rebase",
  "reset",
  "restore",
  "revert",
  "stash",
  "switch",
]);
const WORKTREE_ADD_VALUE_OPTIONS = new Set(["-b", "-B", "--reason", "--orphan"]);
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g;
const SEPARATORS = new Set([";", "&", "|", "(", ")", "\n"]);

interface Recorder {
  roots: EvidenceRoots;
  home: string;
  evidence: Map<string, EvidenceScore>;
}

function isInside(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function findRoot(target: string, roots: EvidenceRoots): string | null {
  let best: string | null = null;
  for (const root of roots.worktrees) {
    if (isInside(target, root) && (best === null || root.length > best.length)) best = root;
  }
  for (const container of roots.containers) {
    if (!target.startsWith(container + path.sep)) continue;
    const slug = target.slice(container.length + 1).split(path.sep)[0];
    const candidate = path.join(container, slug);
    if (best === null || candidate.length > best.length) best = candidate;
  }
  return best;
}

function record(
  recorder: Recorder,
  target: string,
  weight: number,
  signal: { isStrong: boolean; branch?: string },
): void {
  const root = findRoot(target, recorder.roots);
  if (root === null) return;
  const current = recorder.evidence.get(root) ?? { score: 0, isStrong: false, branch: null };
  recorder.evidence.set(root, {
    score: current.score + weight,
    isStrong: current.isStrong || signal.isStrong,
    branch: current.branch ?? signal.branch ?? null,
  });
}

function resolveFrom(directory: string, home: string, token: string): string {
  if (token === "~") return home;
  if (token.startsWith("~/")) return path.join(home, token.slice(2));
  return path.resolve(directory, token);
}

function isPathLike(token: string): boolean {
  return token.includes("/") && !token.includes("://") && !token.startsWith("$");
}

/** Splits a shell command into simple commands; quotes are honoured, expansions are not. */
export function splitCommands(command: string): string[][] {
  const source = command.replace(HEREDOC, "\n");
  const commands: string[][] = [[]];
  let word = "";
  let hasWord = false;
  let quote: "'" | '"' | null = null;
  const endWord = () => {
    if (hasWord) commands[commands.length - 1].push(word);
    word = "";
    hasWord = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      const isEscape = quote === '"' && char === "\\" && index + 1 < source.length;
      if (char === quote) quote = null;
      else if (isEscape) word += source[++index];
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasWord = true;
    } else if (char === "\\" && index + 1 < source.length) {
      word += source[++index];
      hasWord = true;
    } else if (SEPARATORS.has(char)) {
      endWord();
      commands.push([]);
    } else if (char === " " || char === "\t" || char === "\r") {
      endWord();
    } else {
      word += char;
      hasWord = true;
    }
  }
  endWord();
  return commands.filter((words) => words.length > 0);
}

function stripAssignments(words: readonly string[]): readonly string[] {
  const start = words.findIndex((word) => !/^[A-Za-z_]\w*=/.test(word));
  return start === -1 ? [] : words.slice(start);
}

function scanWorktreeAdd(recorder: Recorder, directory: string, args: readonly string[]): void {
  let branch: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (WORKTREE_ADD_VALUE_OPTIONS.has(arg)) {
      if (arg !== "--reason") branch = args[index + 1];
      index += 1;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  if (positional.length === 0) return;
  const target = resolveFrom(directory, recorder.home, positional[0]);
  record(recorder, target, WEIGHT.worktreeAdd, { isStrong: true, branch });
}

function scanGit(recorder: Recorder, directory: string, args: readonly string[]): void {
  let gitDirectory = directory;
  let hasDirectoryOption = false;
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    if (args[index] === "-C") {
      gitDirectory = resolveFrom(gitDirectory, recorder.home, args[index + 1] ?? ".");
      hasDirectoryOption = true;
    }
    index += args[index] === "-C" || args[index] === "-c" ? 2 : 1;
  }
  const subcommand = args[index];
  if (hasDirectoryOption) {
    const isStrong = MUTATING_GIT.has(subcommand);
    record(recorder, gitDirectory, WEIGHT.gitDirectory, { isStrong });
  }
  if (subcommand === "worktree" && args[index + 1] === "add") {
    scanWorktreeAdd(recorder, gitDirectory, args.slice(index + 2));
  }
}

/** Options like `--file=src/a.ts` carry their path after the equals sign. */
function mentionedPath(word: string): string | null {
  const value = word.startsWith("-") ? word.split("=").slice(1).join("=") : word;
  return isPathLike(value) ? value : null;
}

function scanMentions(recorder: Recorder, directory: string, words: readonly string[]): void {
  for (const word of words) {
    const mentioned = mentionedPath(word);
    if (mentioned === null) continue;
    record(recorder, resolveFrom(directory, recorder.home, mentioned), WEIGHT.mention, {
      isStrong: false,
    });
  }
}

/** Returns the working directory after the script, since agent shells keep it between calls. */
function scanShell(recorder: Recorder, startDirectory: string, script: string): string {
  let directory = startDirectory;
  for (const commandWords of splitCommands(script)) {
    const [program, ...args] = stripAssignments(commandWords);
    if (program === undefined) continue;
    if (program === "cd" || program === "pushd") {
      directory = resolveFrom(directory, recorder.home, args[0] ?? "~");
      record(recorder, directory, WEIGHT.cd, { isStrong: true });
    } else if (SHELLS.has(program)) {
      const flagIndex = args.findIndex((arg) => /^-\w*c$/.test(arg));
      if (flagIndex !== -1 && args[flagIndex + 1])
        scanShell(recorder, directory, args[flagIndex + 1]);
    } else if (program === "git") {
      scanGit(recorder, directory, args);
    } else {
      scanMentions(recorder, directory, args);
    }
  }
  return directory;
}

function scanText(recorder: Recorder, directory: string, text: string): void {
  for (const word of text.split(/[\s"'`()<>[\]{},]+/)) {
    if (isPathLike(word) && path.isAbsolute(word)) {
      record(recorder, resolveFrom(directory, recorder.home, word), WEIGHT.userMention, {
        isStrong: false,
      });
    }
  }
}

function scanToolCall(
  recorder: Recorder,
  directory: string,
  item: Extract<TimelineItem, { type: "tool_call" }>,
): string {
  const { detail } = item;
  switch (detail.type) {
    case "shell": {
      if (detail.cwd !== undefined) {
        record(recorder, detail.cwd, WEIGHT.shellCwd, { isStrong: true });
      }
      const endDirectory = scanShell(recorder, detail.cwd ?? directory, detail.command);
      return detail.cwd === undefined ? endDirectory : directory;
    }
    case "edit":
    case "write":
      record(recorder, resolveFrom(directory, recorder.home, detail.filePath), WEIGHT.edit, {
        isStrong: true,
      });
      return directory;
    case "read":
      record(recorder, resolveFrom(directory, recorder.home, detail.filePath), WEIGHT.read, {
        isStrong: false,
      });
      return directory;
    case "worktree_setup":
      record(recorder, detail.worktreePath, WEIGHT.worktreeSetup, {
        isStrong: true,
        branch: detail.branchName,
      });
      return directory;
    default:
      return directory;
  }
}

/**
 * Scores which worktrees an agent worked in. Tool output and assistant prose are ignored:
 * listings such as `git worktree list` mention every worktree without meaning any of them.
 */
export function collectEvidence({ items, directory, home, roots }: EvidenceScan): Evidence {
  const recorder: Recorder = { roots, home, evidence: new Map() };
  let currentDirectory = directory;
  for (const item of items) {
    if (item.type === "tool_call")
      currentDirectory = scanToolCall(recorder, currentDirectory, item);
    else if (item.type === "user_message") scanText(recorder, currentDirectory, item.text);
  }
  return Object.fromEntries(recorder.evidence);
}

/** Rescans see the whole in-memory timeline again, so the stronger reading wins instead of adding up. */
export function mergeEvidence(previous: Evidence, next: Evidence): Evidence {
  const merged: Evidence = { ...previous };
  for (const [worktree, score] of Object.entries(next)) {
    const known = merged[worktree];
    merged[worktree] =
      known === undefined
        ? score
        : {
            score: Math.max(known.score, score.score),
            isStrong: known.isStrong || score.isStrong,
            branch: known.branch ?? score.branch,
          };
  }
  return merged;
}

/** Evidence from several agents of one task adds up. */
export function combineEvidence(sources: readonly Evidence[]): Evidence {
  const combined: Evidence = {};
  for (const source of sources) {
    for (const [worktree, score] of Object.entries(source)) {
      const known = combined[worktree];
      combined[worktree] = {
        score: (known?.score ?? 0) + score.score,
        isStrong: (known?.isStrong ?? false) || score.isStrong,
        branch: known?.branch ?? score.branch,
      };
    }
  }
  return combined;
}

/**
 * A task that ran `git status` in the main checkout before switching to its worktree must not
 * inherit the main checkout's state, so main checkouts only count when nothing else is linked.
 */
export function selectLinks(
  evidence: Evidence,
  mainCheckouts: ReadonlySet<string>,
): LinkedWorktree[] {
  const linked = Object.entries(evidence)
    .filter(([, score]) => score.isStrong && score.score >= MIN_LINK_SCORE)
    .map(([worktree, score]) => ({ path: worktree, score: score.score, branch: score.branch }))
    .sort((left, right) => right.score - left.score);
  const hasWorktree = linked.some((link) => !mainCheckouts.has(link.path));
  return hasWorktree ? linked.filter((link) => !mainCheckouts.has(link.path)) : linked;
}
