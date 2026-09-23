import { useRpc, useSettings, useWorkspace } from "@getpaseo/plugin/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { candidatesRpc, overviewRpc, refreshRpc, workspaceStatusRpc } from "../shared/contracts";
import { linkSettings } from "../shared/settings";

export const QUERY_ROOT = "worktree-status";
const SCANNING_INTERVAL_MS = 3_000;
const RUNNING_INTERVAL_MS = 20_000;
const IDLE_INTERVAL_MS = 60_000;
const OVERVIEW_INTERVAL_MS = 30_000;
const STALE_MS = 5_000;
const NO_OVERRIDES: Record<string, string[]> = {};

export interface LinkOverrides {
  isReady: boolean;
  overrides: Record<string, string[]>;
}

/** Unreadable link settings fall back to automatic links; the picker shows the settings error. */
export function useLinkOverrides(): LinkOverrides {
  const settings = useSettings(linkSettings);
  const values = settings.status === "ready" ? settings.values : null;
  const isReady = settings.status !== "loading";
  return useMemo(() => {
    if (values === null) return { isReady, overrides: NO_OVERRIDES };
    const entries = Object.entries(values.overrides).map(([id, link]) => [id, link.worktrees]);
    return { isReady, overrides: Object.fromEntries(entries) };
  }, [isReady, values]);
}

export function useWorkspaceStatus(workspaceId: string) {
  const fetchStatus = useRpc(workspaceStatusRpc);
  const isRunning = useWorkspace(workspaceId, (workspace) => workspace.status === "running");
  // A new status timestamp means a turn started or ended, which is when git state moves.
  const statusEnteredAt = useWorkspace(workspaceId, (workspace) => workspace.statusEnteredAt);
  const links = useLinkOverrides();
  const override = links.overrides[workspaceId] ?? null;
  return useQuery({
    queryKey: [QUERY_ROOT, "workspace", workspaceId, statusEnteredAt, override],
    queryFn: () => fetchStatus({ workspaceId, override }),
    enabled: links.isReady,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (query.state.data?.isScanning) return SCANNING_INTERVAL_MS;
      return isRunning ? RUNNING_INTERVAL_MS : IDLE_INTERVAL_MS;
    },
  });
}

export function useOverview() {
  const fetchOverview = useRpc(overviewRpc);
  const { isReady, overrides } = useLinkOverrides();
  return useQuery({
    queryKey: [QUERY_ROOT, "overview", overrides],
    queryFn: () => fetchOverview({ overrides }),
    enabled: isReady,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data?.isScanning ? SCANNING_INTERVAL_MS : OVERVIEW_INTERVAL_MS,
  });
}

export function useCandidates(workspaceId: string, isEnabled: boolean) {
  const fetchCandidates = useRpc(candidatesRpc);
  return useQuery({
    queryKey: [QUERY_ROOT, "candidates", workspaceId],
    queryFn: () => fetchCandidates({ workspaceId }),
    enabled: isEnabled,
  });
}

export function useRefresh(workspaceId: string | null) {
  const refresh = useRpc(refreshRpc);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refresh({ workspaceId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_ROOT] }),
  });
}
