import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { GlyphIcon } from "./glyph-icon";
import { useWorkspaceStatus } from "./queries";

export function StatusIcon({ workspaceId, size, color, theme }: PluginButtonIconProps) {
  const { data } = useWorkspaceStatus(workspaceId);
  return <GlyphIcon state={data?.state ?? "none"} size={size} theme={theme} mutedColor={color} />;
}
