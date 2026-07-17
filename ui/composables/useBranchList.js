import { ref, computed } from "vue";
import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { getWithRetry } from "../utils/api-retry.js";
import { normalizeLocalBranches, filterRemoteBranches, buildWorktreeMap } from "../utils/git-branch.js";

// モジュールスコープ: コンポーネント再マウント後もキャッシュを保持する
const _remoteCache = new Map();

export function useBranchList() {
  const { apiGet, wsEndpoint } = useApi();
  const { withWorkspace } = useWorkspace();

  const localBranches = ref([]);
  const remoteBranches = ref([]);
  const worktrees = ref([]);
  const remoteLoaded = ref(false);
  const isBranchListLoading = ref(false);
  const isRemoteBranchListLoading = ref(false);
  const isSwitchingBranch = ref(false);

  const worktreeByBranch = computed(() => buildWorktreeMap(worktrees.value));
  const branches = computed(() => [...localBranches.value, ...remoteBranches.value]);

  function linkedWorktree(branch) {
    const wt = worktreeByBranch.value[branch.name];
    return wt && !wt.is_main ? wt : null;
  }

  async function loadBranchList() {
    isSwitchingBranch.value = false;
    await withWorkspace(async (workspace) => {
      isBranchListLoading.value = true;
      try {
        const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, "branches"));
        if (!ok) return;
        localBranches.value = normalizeLocalBranches(data);
        const cached = _remoteCache.get(workspace);
        if (cached) {
          remoteBranches.value = cached;
          remoteLoaded.value = true;
        } else {
          remoteBranches.value = [];
          remoteLoaded.value = false;
        }
      } catch (e) {
        console.error("branch load failed:", e);
      } finally {
        isBranchListLoading.value = false;
      }
    });
    await loadWorktrees();
  }

  async function loadWorktrees() {
    await withWorkspace(async (workspace) => {
      const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, "worktrees"));
      if (!ok) return;
      worktrees.value = data?.worktrees || [];
    });
  }

  // GET branches/remote は読み取り専用（ローカルのリモート追跡refを返すだけ）。
  // 鮮度は呼び出し側の POST fetch（useBranchActions の fetchRemote）が担う。
  async function loadRemoteBranches() {
    if (isRemoteBranchListLoading.value) return;
    await withWorkspace(async (workspace) => {
      isRemoteBranchListLoading.value = true;
      try {
        const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, "branches/remote"));
        if (!ok) return;
        const filtered = filterRemoteBranches(data, localBranches.value);
        remoteBranches.value = filtered;
        remoteLoaded.value = true;
        _remoteCache.set(workspace, filtered);
      } catch (e) {
        console.error("remote branch load failed:", e);
      } finally {
        isRemoteBranchListLoading.value = false;
      }
    });
  }

  function invalidateRemoteCache(workspace) {
    _remoteCache.delete(workspace);
  }

  return {
    localBranches,
    remoteBranches,
    worktrees,
    remoteLoaded,
    isBranchListLoading,
    isRemoteBranchListLoading,
    isSwitchingBranch,
    worktreeByBranch,
    branches,
    linkedWorktree,
    loadBranchList,
    loadWorktrees,
    loadRemoteBranches,
    invalidateRemoteCache,
  };
}
