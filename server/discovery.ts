import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isAbsentPathError } from "./files";
import { probeGit } from "./git";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "vendor"]);
const MAX_DEPTH = 2;

/** Main repository root for any path inside a checkout or linked worktree. */
export async function resolveRepositoryRoot(directory: string): Promise<string | null> {
  const result = await probeGit(directory, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (result.exitCode !== 0) return null;
  const commonDir = result.stdout.trim();
  // A bare repository has no main checkout, so its git directory is the root.
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
}

async function hasGitEntry(directory: string): Promise<boolean> {
  try {
    await stat(path.join(directory, ".git"));
    return true;
  } catch (error) {
    if (isAbsentPathError(error)) return false;
    throw error;
  }
}

async function listChildDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (isAbsentPathError(error)) return [];
    throw error;
  }
}

async function findCheckouts(directory: string, depth: number): Promise<string[]> {
  const children = await listChildDirectories(directory);
  const nested = await Promise.all(
    children.map(async (child) => {
      if (await hasGitEntry(child)) return [child];
      return depth > 1 ? findCheckouts(child, depth - 1) : [];
    }),
  );
  return nested.flat();
}

/**
 * Workspaces often sit one level above their repositories, so a directory that is not a
 * checkout itself is searched a short way down.
 */
export async function discoverRepositories(directory: string): Promise<string[]> {
  const ownRoot = await resolveRepositoryRoot(directory);
  if (ownRoot !== null) return [ownRoot];
  const checkouts = await findCheckouts(directory, MAX_DEPTH);
  const roots = await Promise.all(checkouts.map(resolveRepositoryRoot));
  const uniqueRoots = new Set(roots.filter((root) => root !== null));
  return [...uniqueRoots].sort();
}
