import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  LinkSource,
  RepositoryStatus,
  WorktreeCandidate,
  WorktreeStatus,
} from "../shared/contracts";
import { linkSettings } from "../shared/settings";
import { CopyButton, shellQuote, TextButton } from "./controls";
import { GlyphIcon } from "./glyph-icon";
import { describeWorktree, GLYPHS, worktreeName } from "./glyphs";
import { useCandidates, useRefresh, useWorkspaceStatus } from "./queries";

type Choice = "automatic" | "none" | "worktree";

const LINK_SOURCE_LABELS: Record<LinkSource, string> = {
  manual: "Linked manually",
  workspace: "Linked by the workspace folder",
  agent: "Linked by the agent folder",
  timeline: "Linked from agent activity",
};

function usePopoverStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      root: { gap: 12, padding: 12 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      spread: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      column: { flex: 1, gap: 4 },
      section: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border },
      title: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      text: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tint: { color: theme.colors.statusWarning, fontSize: 12 },
      danger: { color: theme.colors.statusDanger, fontSize: 12 },
      choice: { paddingVertical: 4, gap: 4 },
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

interface ChoiceRowProps {
  choice: Choice;
  path: string | null;
  label: string;
  detail: string;
  styles: PopoverStyles;
  onChoose(choice: Choice, path: string | null): void;
}

function ChoiceRow({ choice, path, label, detail, styles, onChoose }: ChoiceRowProps) {
  const choose = useCallback(() => onChoose(choice, path), [choice, path, onChoose]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={choose}
      style={styles.choice}
    >
      <Text style={styles.text}>{label}</Text>
      <Text style={styles.muted}>{detail}</Text>
    </Pressable>
  );
}

function candidateLabel(candidate: WorktreeCandidate): string {
  return candidate.isMainCheckout
    ? `${candidate.repositoryName} main checkout`
    : (candidate.path.split("/").pop() ?? candidate.path);
}

interface LinkPickerProps {
  workspaceId: string;
  styles: PopoverStyles;
  onDone(): void;
}

function LinkPicker({ workspaceId, styles, onDone }: LinkPickerProps) {
  const candidates = useCandidates(workspaceId, true);
  const settings = useSettings(linkSettings);
  // Saving updates the settings everywhere, which changes the status query keys and refetches.
  const choose = useCallback(
    async (choice: Choice, path: string | null) => {
      if (settings.status !== "ready") return;
      const others = Object.fromEntries(
        Object.entries(settings.values.overrides).filter(([id]) => id !== workspaceId),
      );
      const worktrees = choice === "worktree" && path !== null ? [path] : [];
      const overrides =
        choice === "automatic" ? others : { ...others, [workspaceId]: { worktrees } };
      const isSaved = await settings.save({ overrides }, settings.revision);
      if (isSaved) onDone();
    },
    [settings, workspaceId, onDone],
  );
  const handleChoose = useCallback(
    (choice: Choice, path: string | null) => void choose(choice, path),
    [choose],
  );

  if (settings.status === "loading" || candidates.isPending) {
    return <Text style={styles.muted}>Loading worktrees...</Text>;
  }
  if (settings.status !== "ready") return <Text style={styles.danger}>{settings.error}</Text>;
  if (candidates.isError) return <Text style={styles.danger}>{candidates.error.message}</Text>;
  return (
    <View>
      <ChoiceRow
        choice="automatic"
        path={null}
        label="Automatic"
        detail="Follow agent activity"
        styles={styles}
        onChoose={handleChoose}
      />
      <ChoiceRow
        choice="none"
        path={null}
        label="No worktree"
        detail="This task does not use git"
        styles={styles}
        onChoose={handleChoose}
      />
      {candidates.data.worktrees.map((candidate) => (
        <ChoiceRow
          key={candidate.path}
          choice="worktree"
          path={candidate.path}
          label={candidateLabel(candidate)}
          detail={candidate.branch ?? "Detached HEAD"}
          styles={styles}
          onChoose={handleChoose}
        />
      ))}
      {settings.saving ? <Text style={styles.muted}>Saving...</Text> : null}
      {settings.saveError === null ? null : <Text style={styles.danger}>{settings.saveError}</Text>}
    </View>
  );
}

interface LinkSectionProps {
  workspaceId: string;
  linkSource: LinkSource | null;
  theme: PluginTheme;
  styles: PopoverStyles;
}

function LinkSection({ workspaceId, linkSource, theme, styles }: LinkSectionProps) {
  const [isChoosing, setIsChoosing] = useState(false);
  const toggle = useCallback(() => setIsChoosing((value) => !value), []);
  const close = useCallback(() => setIsChoosing(false), []);
  const refresh = useRefresh(workspaceId);
  const runRefresh = useCallback(() => refresh.mutate(), [refresh]);
  return (
    <View style={styles.section}>
      <View style={styles.spread}>
        <Text style={styles.muted}>
          {linkSource === null ? "Not linked" : LINK_SOURCE_LABELS[linkSource]}
        </Text>
        <TextButton label={isChoosing ? "Cancel" : "Change"} theme={theme} onPress={toggle} />
      </View>
      {isChoosing ? <LinkPicker workspaceId={workspaceId} styles={styles} onDone={close} /> : null}
      <TextButton
        label={refresh.isPending ? "Refreshing..." : "Refresh"}
        theme={theme}
        onPress={runRefresh}
        isDisabled={refresh.isPending}
      />
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
      <LinkSection
        workspaceId={workspaceId}
        linkSource={data.linkSource}
        theme={theme}
        styles={styles}
      />
    </View>
  );
}
