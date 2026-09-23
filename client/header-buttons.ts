import type { OwnedSubscription, PaseoWorkspaceListResult } from "@getpaseo/client";
import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { StatusIcon } from "./status-icon";
import { StatusPopover } from "./status-popover";

/** Header buttons are per workspace, so they follow the live workspace list. */
export function registerHeaderButtons(client: PluginClientContext): () => void {
  const registrations = new Map<string, PluginButtonRegistration>();
  let subscription: OwnedSubscription<PaseoWorkspaceListResult> | null = null;
  let stopObserving: (() => void) | null = null;
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

  client.paseo.workspaces
    .list({ subscribe: {} })
    .then((result) => {
      if (isStopped) return result.subscription.release();
      subscription = result.subscription;
      sync(result.entries.map((workspace) => workspace.id));
      stopObserving = result.subscription.subscribe({
        snapshot: (snapshot) => sync(snapshot.entries.map((workspace) => workspace.id)),
        update: (message) => {
          if (message.type !== "workspace_update") return;
          if (message.payload.kind === "remove") drop(message.payload.id);
          else ensure(message.payload.workspace.id);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      console.error("[worktree-status] could not follow the workspace list", error);
    });

  return () => {
    isStopped = true;
    stopObserving?.();
    void subscription?.release();
    for (const registration of registrations.values()) registration.remove();
    registrations.clear();
  };
}
