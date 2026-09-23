import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerHeaderButtons } from "./client/header-buttons";
import { OverviewSurface } from "./client/overview-surface";

export default function contribute(client: PluginClientContext) {
  client.addSurface("overview", OverviewSurface);
  client.addSidebarItem({
    id: "overview",
    title: "Worktrees",
    icon: "GitBranch",
    surface: "overview",
  });
  client.addCommandCenterItem({
    id: "open-overview",
    title: "Open worktree overview",
    icon: "GitBranch",
    keywords: ["git", "merge", "branch", "status"],
    context: "global",
    onSelect: ({ openSurface }) => openSurface("overview"),
  });
  return registerHeaderButtons(client);
}
