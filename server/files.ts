import { readFile } from "node:fs/promises";

const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

export function isAbsentPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && ABSENT_CODES.has(String(error.code));
}

/** Reads a file that may legitimately not exist; other I/O errors still throw. */
export async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isAbsentPathError(error)) return null;
    throw error;
  }
}
