import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import type { RepositoryStatus, WorktreeStatus } from "../shared/contracts";
import { CopyButton, shellQuote, TextButton } from "./controls";
import { GlyphIcon } from "./glyph-icon";
import { describeWorktree, formatClockTime, GLYPHS, worktreeName } from "./glyphs";
import { useRefresh, useWorkspaceStatus } from "./queries";

function usePopoverStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      root: { gap: 12, padding: 12 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      column: { flex: 1, gap: 4 },
      section: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      text: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tint: { color: theme.colors.statusWarning, fontSize: 12 },
      danger: { color: theme.colors.statusDanger, fontSize: 12 },
    }),
    [theme],
  );
}

type PopoverStyles = ReturnType<typeof usePopoverStyles>;

interface WorktreeLineProps {
  status: WorktreeStatus;
  theme: PluginTheme;
  styles: PopoverStyles;
}

function cleanupCommand(status: WorktreeStatus): { label: string; text: string } | null {
  const repository = shellQuote(status.repositoryRoot);
  const isRemovable = status.state === "done" && status.presence === "present";
  if (isRemovable && !status.isMainCheckout) {
    return {
      label: "Copy remove command",
      text: `git -C ${repository} worktree remove ${shellQuote(status.path)}`,
    };
  }
  if (status.state === "missing") {
    return { label: "Copy prune command", text: `git -C ${repository} worktree prune` };
  }
  return null;
}

function WorktreeLine({ status, theme, styles }: WorktreeLineProps) {
  const command = cleanupCommand(status);
  const branch = status.branch === null ? "" : ` · ${status.branch}`;
  return (
    <View style={styles.row}>
      <GlyphIcon
        state={status.state}
        size={14}
        theme={theme}
        mutedColor={theme.colors.foregroundMuted}
      />
      <View style={styles.column}>
        <Text style={styles.text} numberOfLines={1}>
          {worktreeName(status)}
          {branch}
        </Text>
        <Text style={styles.muted}>{describeWorktree(status)}</Text>
        {command === null ? null : (
          <CopyButton label={command.label} text={command.text} theme={theme} />
        )}
      </View>
    </View>
  );
}

interface RepositoryNoteProps {
  repository: RepositoryStatus;
  theme: PluginTheme;
  styles: PopoverStyles;
}

function RepositoryNote({ repository, theme, styles }: RepositoryNoteProps) {
  const unpushed = repository.unpushedCommits ?? 0;
  if (unpushed === 0 || repository.baseBranch === null) return null;
  const pushCommand = `git -C ${shellQuote(repository.root)} push origin ${repository.baseBranch}`;
  return (
    <View style={styles.section}>
      <Text style={styles.tint}>
        {repository.name}: {repository.baseBranch} is {unpushed} commit{unpushed === 1 ? "" : "s"}{" "}
        ahead of origin
      </Text>
      <CopyButton label="Copy push command" text={pushCommand} theme={theme} />
    </View>
  );
}

interface RefreshActionProps {
  workspaceId: string;
  computedAt: string;
  theme: PluginTheme;
  styles: PopoverStyles;
}

function RefreshAction({ workspaceId, computedAt, theme, styles }: RefreshActionProps) {
  const refresh = useRefresh(workspaceId);
  const runRefresh = useCallback(() => refresh.mutate(), [refresh]);
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <TextButton
          label={refresh.isPending ? "Refreshing..." : "Refresh"}
          theme={theme}
          onPress={runRefresh}
          isDisabled={refresh.isPending}
        />
        <Text style={styles.muted}>Updated {formatClockTime(computedAt)}</Text>
      </View>
      {refresh.isError ? <Text style={styles.danger}>{refresh.error.message}</Text> : null}
    </View>
  );
}

export function StatusPopover({ workspaceId, theme }: PluginButtonContentProps) {
  const styles = usePopoverStyles(theme);
  const status = useWorkspaceStatus(workspaceId);
  if (status.isPending) {
    return (
      <View style={styles.root}>
        <Text style={styles.muted}>Reading git state...</Text>
      </View>
    );
  }
  if (status.isError) {
    return (
      <View style={styles.root}>
        <Text style={styles.danger}>{status.error.message}</Text>
      </View>
    );
  }
  const { data } = status;
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <GlyphIcon
          state={data.state}
          size={16}
          theme={theme}
          mutedColor={theme.colors.foregroundMuted}
        />
        <Text style={styles.title}>{GLYPHS[data.state].label}</Text>
      </View>
      {data.isScanning ? <Text style={styles.muted}>Reading agent activity...</Text> : null}
      {data.worktrees.map((worktree) => (
        <WorktreeLine key={worktree.path} status={worktree} theme={theme} styles={styles} />
      ))}
      {data.repositories.map((repository) => (
        <RepositoryNote
          key={repository.root}
          repository={repository}
          theme={theme}
          styles={styles}
        />
      ))}
      <RefreshAction
        workspaceId={workspaceId}
        computedAt={data.computedAt}
        theme={theme}
        styles={styles}
      />
    </View>
  );
}
