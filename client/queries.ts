import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { overviewRpc, refreshRpc, workspaceStatusRpc } from "../shared/contracts";

export const QUERY_ROOT = "worktree-status";
const SCANNING_INTERVAL_MS = 3_000;
const RUNNING_INTERVAL_MS = 20_000;
const IDLE_INTERVAL_MS = 30_000;
const OVERVIEW_INTERVAL_MS = 30_000;
const STALE_MS = 5_000;

export function useWorkspaceStatus(workspaceId: string) {
  const fetchStatus = useRpc(workspaceStatusRpc);
  const isRunning = useWorkspace(workspaceId, (workspace) => workspace.status === "running");
  // A new status timestamp means a turn started or ended, which is when git state moves.
  const statusEnteredAt = useWorkspace(workspaceId, (workspace) => workspace.statusEnteredAt);
  return useQuery({
    queryKey: [QUERY_ROOT, "workspace", workspaceId, statusEnteredAt],
    queryFn: () => fetchStatus({ workspaceId }),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    // Agents change git state while the app sits in the background, so polling keeps going.
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      if (query.state.data?.isScanning) return SCANNING_INTERVAL_MS;
      return isRunning ? RUNNING_INTERVAL_MS : IDLE_INTERVAL_MS;
    },
  });
}

export function useOverview() {
  const fetchOverview = useRpc(overviewRpc);
  return useQuery({
    queryKey: [QUERY_ROOT, "overview"],
    queryFn: () => fetchOverview({}),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
    refetchInterval: (query) =>
      query.state.data?.isScanning ? SCANNING_INTERVAL_MS : OVERVIEW_INTERVAL_MS,
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
