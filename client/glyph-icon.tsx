import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { View } from "react-native";
import type { WorktreeState } from "../shared/contracts";
import { GLYPHS, toneColor } from "./glyphs";

const FAINT_STYLE = { opacity: 0.45 } as const;

export interface GlyphIconProps {
  state: WorktreeState;
  size: number;
  theme: PluginTheme;
  mutedColor: string;
}

export function GlyphIcon({ state, size, theme, mutedColor }: GlyphIconProps) {
  const glyph = GLYPHS[state];
  const icon = (
    <Icon name={glyph.icon} size={size} color={toneColor(glyph.tone, theme, mutedColor)} />
  );
  return glyph.tone === "faint" ? <View style={FAINT_STYLE}>{icon}</View> : icon;
}
