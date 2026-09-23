import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { StatusIcon } from "./status-icon";
import { StatusPopover } from "./status-popover";

const PAGE_LIMIT = 200;

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
 * Header buttons are per workspace, so they follow the workspace list. The app already streams
 * workspace updates for its sidebar; listening to that stream works on Paseo 0.8 and later,
 * unlike owning a subscription, which 0.8 apps do not return.
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

  const stopListening = client.paseo.workspaces.subscribe((update) => {
    if (update.kind === "remove") drop(update.id);
    else ensure(update.workspace.id);
  });

  listWorkspaceIds(client)
    .then((ids) => {
      for (const id of ids) ensure(id);
      return undefined;
    })
    .catch((error: unknown) => {
      console.error("[worktree-status] could not list workspaces", error);
    });

  return () => {
    isStopped = true;
    stopListening();
    for (const registration of registrations.values()) registration.remove();
    registrations.clear();
  };
}
