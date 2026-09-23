import type { PluginTheme } from "@getpaseo/plugin";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo } from "react";
import { Pressable, Text } from "react-native";

export interface TextButtonProps {
  label: string;
  theme: PluginTheme;
  onPress(): void;
  isDisabled?: boolean;
}

export function TextButton({ label, theme, onPress, isDisabled = false }: TextButtonProps) {
  const styles = useMemo(
    () => ({
      button: { paddingVertical: 4, opacity: isDisabled ? 0.5 : 1 },
      label: { color: theme.colors.accent, fontSize: 13 },
    }),
    [theme, isDisabled],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={isDisabled}
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export interface CopyButtonProps {
  label: string;
  text: string;
  theme: PluginTheme;
}

export function CopyButton({ label, text, theme }: CopyButtonProps) {
  const toast = useToast();
  const copy = useCallback(() => {
    copyText(text).then(
      () => toast.show("Copied to clipboard", { variant: "success" }),
      () => toast.error("Copying is not available here"),
    );
  }, [text, toast]);
  return <TextButton label={label} theme={theme} onPress={copy} />;
}

/** Quotes a path for a POSIX shell so copied commands survive spaces. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
