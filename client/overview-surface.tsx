import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type {
  OverviewRow,
  OverviewSection,
  UnlinkedTask,
  WorktreeState,
  WorktreeStatus,
} from "../shared/contracts";
import { compareStates } from "../shared/state";
import { TextButton } from "./controls";
import { GlyphIcon } from "./glyph-icon";
import { describeWorktree, formatAge, GLYPHS, LEGEND_STATES, worktreeName } from "./glyphs";
import { useOverview, useRefresh } from "./queries";

type OpenWorkspace = NonNullable<PluginSurfaceProps["navigation"]>["openWorkspace"];

function useOverviewStyles(theme: PluginTheme, isCompact: boolean) {
  return useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: isCompact ? 16 : 24, gap: isCompact ? 16 : 24 },
      header: { gap: 4 },
      spread: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      heading: {
        color: theme.colors.foreground,
        fontSize: isCompact ? 20 : 24,
        fontWeight: "600" as const,
      },
      section: { gap: 4 },
      sectionTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      rowText: { flex: 1, gap: 4 },
      title: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tint: { color: theme.colors.statusWarning, fontSize: 12 },
      danger: { color: theme.colors.statusDanger, fontSize: 12 },
      legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 12 },
      legendItem: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
    }),
    [theme, isCompact],
  );
}

type OverviewStyles = ReturnType<typeof useOverviewStyles>;

interface RowProps {
  theme: PluginTheme;
  styles: OverviewStyles;
}

function mostUrgent(worktrees: readonly WorktreeStatus[]): WorktreeStatus | null {
  return [...worktrees].sort((left, right) => compareStates(left.state, right.state))[0] ?? null;
}

interface TaskRowProps extends RowProps {
  row: Extract<OverviewRow, { kind: "task" }>;
  openWorkspace: OpenWorkspace | null;
}

function TaskRow({ row, openWorkspace, theme, styles }: TaskRowProps) {
  const open = useCallback(
    () => openWorkspace?.({ workspaceId: row.workspaceId }),
    [openWorkspace, row.workspaceId],
  );
  const urgent = mostUrgent(row.worktrees);
  const names = row.worktrees.map(worktreeName).join(", ");
  const detail = urgent === null ? names : `${names} · ${describeWorktree(urgent)}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${GLYPHS[row.state].label}`}
      disabled={openWorkspace === null}
      onPress={open}
      style={styles.row}
    >
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <GlyphIcon
        state={row.state}
        size={16}
        theme={theme}
        mutedColor={theme.colors.foregroundMuted}
      />
    </Pressable>
  );
}

interface OrphanRowProps extends RowProps {
  worktree: WorktreeStatus;
}

function OrphanRow({ worktree, theme, styles }: OrphanRowProps) {
  const branch = worktree.branch === null ? "" : `${worktree.branch} · `;
  return (
    <View
      accessible
      accessibilityLabel={`${worktreeName(worktree)}, ${GLYPHS[worktree.state].label}`}
      style={styles.row}
    >
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {worktreeName(worktree)}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {branch}
          {describeWorktree(worktree)}
        </Text>
      </View>
      <GlyphIcon
        state={worktree.state}
        size={16}
        theme={theme}
        mutedColor={theme.colors.foregroundMuted}
      />
    </View>
  );
}

interface SectionViewProps extends RowProps {
  section: OverviewSection;
  openWorkspace: OpenWorkspace | null;
}

function SectionView({ section, openWorkspace, theme, styles }: SectionViewProps) {
  const { repository, rows } = section;
  const unpushed = repository.unpushedCommits ?? 0;
  const base = repository.baseBranch ?? "no base branch";
  const hasOrphans = rows.some((row) => row.kind === "orphan");
  return (
    <View style={styles.section}>
      <View style={styles.spread}>
        <Text style={styles.sectionTitle}>
          {repository.name} · {base}
        </Text>
        {unpushed > 0 ? <Text style={styles.tint}>{`${base} ↑${unpushed} not pushed`}</Text> : null}
      </View>
      {rows.map((row) =>
        row.kind === "task" ? (
          <TaskRow
            key={row.workspaceId}
            row={row}
            openWorkspace={openWorkspace}
            theme={theme}
            styles={styles}
          />
        ) : (
          <OrphanRow
            key={row.worktree.path}
            worktree={row.worktree}
            theme={theme}
            styles={styles}
          />
        ),
      )}
      {hasOrphans ? (
        <Text style={styles.muted}>Worktrees without a task are listed last</Text>
      ) : null}
    </View>
  );
}

interface UnlinkedItemProps extends RowProps {
  task: UnlinkedTask;
  openWorkspace: OpenWorkspace | null;
}

function UnlinkedItem({ task, openWorkspace, styles }: UnlinkedItemProps) {
  const open = useCallback(
    () => openWorkspace?.({ workspaceId: task.workspaceId }),
    [openWorkspace, task.workspaceId],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={task.title}
      disabled={openWorkspace === null}
      onPress={open}
      style={styles.row}
    >
      <Text style={styles.muted} numberOfLines={1}>
        {task.title}
      </Text>
    </Pressable>
  );
}

interface UnlinkedListProps extends RowProps {
  tasks: readonly UnlinkedTask[];
  openWorkspace: OpenWorkspace | null;
}

function UnlinkedList({ tasks, openWorkspace, theme, styles }: UnlinkedListProps) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((value) => !value), []);
  if (tasks.length === 0) return null;
  return (
    <View style={styles.section}>
      <TextButton
        label={`${isOpen ? "Hide" : "Show"} tasks without a worktree (${tasks.length})`}
        theme={theme}
        onPress={toggle}
      />
      {isOpen
        ? tasks.map((task) => (
            <UnlinkedItem
              key={task.workspaceId}
              task={task}
              openWorkspace={openWorkspace}
              theme={theme}
              styles={styles}
            />
          ))
        : null}
    </View>
  );
}

function LegendItem({ state, theme, styles }: RowProps & { state: WorktreeState }) {
  return (
    <View style={styles.legendItem}>
      <GlyphIcon state={state} size={12} theme={theme} mutedColor={theme.colors.foregroundMuted} />
      <Text style={styles.muted}>{GLYPHS[state].label}</Text>
    </View>
  );
}

export function OverviewSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const styles = useOverviewStyles(theme, layout.compact);
  const overview = useOverview();
  const refresh = useRefresh(null);
  const runRefresh = useCallback(() => refresh.mutate(), [refresh]);
  const openWorkspace = navigation?.openWorkspace ?? null;
  const { data } = overview;
  const updated = data === undefined ? "" : `Updated ${formatAge(data.computedAt, Date.now())}`;
  const scanning = data?.isScanning ? " · reading agent activity..." : "";
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.spread}>
          <Text style={styles.heading}>Worktrees</Text>
          <TextButton
            label={refresh.isPending ? "Refreshing..." : "Refresh"}
            theme={theme}
            onPress={runRefresh}
            isDisabled={refresh.isPending}
          />
        </View>
        <Text style={styles.muted}>
          {updated}
          {scanning}
        </Text>
        {refresh.isError ? <Text style={styles.danger}>{refresh.error.message}</Text> : null}
      </View>
      {overview.isPending ? <Text style={styles.muted}>Reading git state...</Text> : null}
      {overview.isError ? <Text style={styles.danger}>{overview.error.message}</Text> : null}
      {data?.sections.length === 0 ? <Text style={styles.muted}>No git worktrees</Text> : null}
      {data?.sections.map((section) => (
        <SectionView
          key={section.repository.root}
          section={section}
          openWorkspace={openWorkspace}
          theme={theme}
          styles={styles}
        />
      ))}
      {data === undefined ? null : (
        <UnlinkedList
          tasks={data.unlinked}
          openWorkspace={openWorkspace}
          theme={theme}
          styles={styles}
        />
      )}
      <View style={styles.legend}>
        {LEGEND_STATES.map((state) => (
          <LegendItem key={state} state={state} theme={theme} styles={styles} />
        ))}
      </View>
    </ScrollView>
  );
}
