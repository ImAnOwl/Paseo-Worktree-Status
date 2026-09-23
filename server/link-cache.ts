import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Evidence } from "./evidence";
import { mergeEvidence } from "./evidence";
import { readOptionalFile } from "./files";

const SAVE_DELAY_MS = 1000;

const AgentEvidenceSchema = z.object({
  workspaceId: z.string(),
  evidence: z.record(
    z.string(),
    z.object({ score: z.number(), isStrong: z.boolean(), branch: z.string().nullable() }),
  ),
});
type AgentEvidence = z.infer<typeof AgentEvidenceSchema>;

const LinkCacheFileSchema = z.object({
  version: z.literal(1),
  agents: z.record(z.string(), AgentEvidenceSchema),
});

export interface LinkCache {
  evidenceFor(workspaceId: string): Evidence[];
  update(agentId: string, workspaceId: string, evidence: Evidence): void;
  flush(): Promise<void>;
}

/** Plugins get no data directory, so the cache lives next to Paseo's own plugin settings. */
export function defaultLinkCachePath(): string {
  const paseoHome = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
  return path.join(paseoHome, "plugin-data", "worktree-status", "links.json");
}

function parseCacheFile(raw: string): Record<string, AgentEvidence> {
  try {
    const parsed = LinkCacheFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.agents : {};
  } catch (error) {
    // A corrupt cache is rebuilt from the timelines instead of breaking the plugin.
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function openLinkCache(filePath: string): Promise<LinkCache> {
  const raw = await readOptionalFile(filePath);
  const agents = new Map(Object.entries(raw === null ? {} : parseCacheFile(raw)));
  let pendingSave: NodeJS.Timeout | null = null;

  async function save(): Promise<void> {
    pendingSave = null;
    const contents = JSON.stringify({ version: 1, agents: Object.fromEntries(agents) });
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  }

  function scheduleSave(): void {
    if (pendingSave !== null) return;
    pendingSave = setTimeout(() => {
      save().catch((error: unknown) => {
        console.error("[worktree-status] failed to save link cache", error);
      });
    }, SAVE_DELAY_MS);
  }

  return {
    evidenceFor(workspaceId) {
      return [...agents.values()]
        .filter((agent) => agent.workspaceId === workspaceId)
        .map((agent) => agent.evidence);
    },
    update(agentId, workspaceId, evidence) {
      const previous = agents.get(agentId);
      const merged = previous === undefined ? evidence : mergeEvidence(previous.evidence, evidence);
      agents.set(agentId, { workspaceId, evidence: merged });
      scheduleSave();
    },
    async flush() {
      if (pendingSave === null) return;
      clearTimeout(pendingSave);
      await save();
    },
  };
}
