import os from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { candidatesRpc, overviewRpc, refreshRpc, workspaceStatusRpc } from "./shared/contracts";
import { linkSettings } from "./shared/settings";
import { defaultLinkCachePath, openLinkCache } from "./server/link-cache";
import type { StatusService } from "./server/status";
import { createStatusService } from "./server/status";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(linkSettings);
  let service: Promise<StatusService> | null = null;

  // The cache file is read on first use so a slow disk never delays plugin startup.
  function getService(): Promise<StatusService> {
    service ??= openLinkCache(defaultLinkCachePath()).then((cache) =>
      createStatusService({ settings, cache, home: os.homedir() }),
    );
    return service;
  }

  server.handle(workspaceStatusRpc, async ({ workspaceId }, { paseo }) =>
    (await getService()).workspaceStatus(paseo, workspaceId),
  );
  server.handle(overviewRpc, async (_input, { paseo }) => (await getService()).overview(paseo));
  server.handle(refreshRpc, async ({ workspaceId }, { paseo }) =>
    (await getService()).refresh(paseo, workspaceId),
  );
  server.handle(candidatesRpc, async ({ workspaceId }, { paseo }) =>
    (await getService()).candidates(paseo, workspaceId),
  );

  const stopTurnEnded = server.on("agent.turn_ended", async (event, { paseo }) => {
    await (await getService()).onTurnEnded(paseo, event);
  });
  const stopArchived = server.on("workspace.archived", async () => {
    (await getService()).onWorkspaceArchived();
  });

  return async () => {
    stopTurnEnded();
    stopArchived();
    if (service !== null) await (await service).dispose();
  };
}
