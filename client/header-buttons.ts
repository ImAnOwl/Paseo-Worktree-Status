import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { StatusIcon } from "./status-icon";
import { StatusPopover } from "./status-popover";

const PAGE_LIMIT = 200;
const RESYNC_INTERVAL_MS = 15_000;

async function listWorkspaceIds(client: PluginClientContext): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.paseo.workspaces.list({ page: { limit: PAGE_LIMIT, cursor } });
    for (const workspace of page.entries) ids.push(workspace.id);
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return ids;
}

/**
 * Header buttons are per workspace, so they follow the workspace list. Update events register new
 * workspaces right away where the app forwards them to plugins; not every app does, so the list is
 * also re-read periodically. Owning a subscription is not an option because 0.8 apps return none.
 */
export function registerHeaderButtons(client: PluginClientContext): () => void {
  const registrations = new Map<string, PluginButtonRegistration>();
  let isStopped = false;

  function ensure(workspaceId: string): void {
    // Registering the same button twice throws, and upserts arrive for every change.
    if (isStopped || registrations.has(workspaceId)) return;
    const registration = client.addHeaderButton({
      id: "worktree-status",
      workspaceId,
      button: {
        title: "Worktree status",
        icon: StatusIcon,
        behavior: { kind: "popover", Content: StatusPopover },
      },
    });
    registrations.set(workspaceId, registration);
  }

  function drop(workspaceId: string): void {
    registrations.get(workspaceId)?.remove();
    registrations.delete(workspaceId);
  }

  function sync(workspaceIds: readonly string[]): void {
    const current = new Set(workspaceIds);
    for (const workspaceId of registrations.keys()) {
      if (!current.has(workspaceId)) drop(workspaceId);
    }
    for (const workspaceId of current) ensure(workspaceId);
  }

  let isSyncing = false;
  async function resync(): Promise<void> {
    if (isSyncing || isStopped) return;
    isSyncing = true;
    try {
      sync(await listWorkspaceIds(client));
    } catch (error) {
      console.error("[worktree-status] could not list workspaces", error);
    } finally {
      isSyncing = false;
    }
  }

  const stopListening = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "remove") drop(update.id);
    else ensure(update.workspace.id);
  });
  void resync();
  const resyncTimer = setInterval(() => void resync(), RESYNC_INTERVAL_MS);

  return () => {
    isStopped = true;
    clearInterval(resyncTimer);
    stopListening();
    for (const registration of registrations.values()) registration.remove();
    registrations.clear();
  };
}
