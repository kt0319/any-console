import { ref, computed } from "vue";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { normalizeLocalBranches, filterRemoteBranches, buildWorktreeMap, markMergedBranches, type LocalBranch, type MergedPull } from "../utils/git-branch.ts";

// モジュールスコープ: コンポーネント再マウント後もキャッシュを保持する
const _remoteCache = new Map<string, any[]>();

export function useBranchList() {
  const { apiGet, wsEndpoint } = useApi();
  const { withWorkspace } = useWorkspace();

  const loadedLocalBranches = ref<LocalBranch[]>([]);
  const mergedPulls = ref<MergedPull[]>([]);
  const localBranches = computed(() => markMergedBranches(loadedLocalBranches.value, mergedPulls.value));
  const remoteBranches = ref<any[]>([]);
  const worktrees = ref<any[]>([]);
  const remoteLoaded = ref(false);
  const isBranchListLoading = ref(false);
  const isRemoteBranchListLoading = ref(false);
  const isSwitchingBranch = ref(false);

  const worktreeByBranch = computed(() => buildWorktreeMap(worktrees.value));
  const branches = computed(() => [...localBranches.value, ...remoteBranches.value]);

  function linkedWorktree(branch: { name: string }) {
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
        loadedLocalBranches.value = normalizeLocalBranches(data);
        void loadMergedPulls(workspace);
        const cached = _remoteCache.get(workspace);
        if (cached) {
          // キャッシュはローカル一覧が更新される前のフィルタ結果のため、
          // そのまま使うとローカルブランチ作成/チェックアウト後に同名の
          // ブランチがローカル・リモート両方の一覧に重複して出てしまう。
          // 最新のlocalBranchesで再フィルタしてからキャッシュも更新する。
          const refiltered = filterRemoteBranches(cached, localBranches.value);
          remoteBranches.value = refiltered;
          remoteLoaded.value = true;
          _remoteCache.set(workspace, refiltered);
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

  // 打ち消し線表示の補助情報。gh 未導入・未ログイン等で取れなくても一覧自体は成立するため、
  // 失敗時は祖先関係による判定（サーバ側）だけで表示する。
  async function loadMergedPulls(workspace: string) {
    const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, "github/pulls?state=merged"));
    mergedPulls.value = ok && data?.status === "ok" && Array.isArray(data.data) ? data.data : [];
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

  function invalidateRemoteCache(workspace: string) {
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
