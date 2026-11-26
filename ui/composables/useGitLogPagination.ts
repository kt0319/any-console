import { ref, computed, nextTick } from "vue";
import { useGitStore } from "../stores/git.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { parseGitGraphOutput, buildGitGraphRows, computeGraphWidth } from "../utils/git-graph.ts";
import { INFINITE_SCROLL_THRESHOLD_PX } from "../utils/constants.ts";

type GitGraphRow = ReturnType<typeof buildGitGraphRows>[number];

export function useGitLogPagination() {
  const { withWorkspace } = useWorkspace();
  const gitStore = useGitStore();
  const workspaceStore = useWorkspaceStore();
  const { apiGet, wsEndpoint } = useApi();

  const graphRows = ref<GitGraphRow[]>([]);
  const commitEntries = computed(() => graphRows.value.filter((r) => r.entry).map((r) => r.entry));
  const graphWidth = computed(() => computeGraphWidth(graphRows.value));
  const isHistoryLoading = ref(true);
  const hasMoreHistory = ref(false);
  const isLoadingMoreHistory = ref(false);
  const historyListEl = ref<HTMLElement | null>(null);
  let historyPage = 0;
  // loadHistory 時だけ取得し、ページ追加でも先頭に付け直す
  let pendingGraphRows: GitGraphRow[] = [];

  async function _fetchPage(workspace: string, limit: number) {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${limit}&skip=0&graph=true`));
    if (!ok) return null;
    const parsed = parseGitGraphOutput(data.stdout);
    return { rows: buildGitGraphRows(parsed), count: parsed.filter((p) => p.entry).length };
  }

  // git-log は新しい順なので、先頭の ahead 件（未 push 分。upstream 未設定のローカルブランチも含む）に unpushed を付ける
  function _markUnpushed(rows: GitGraphRow[]) {
    let remaining = Number(workspaceStore.currentWorkspace?.ahead) || 0;
    if (remaining <= 0) return;
    for (const row of rows) {
      if (!row.entry) continue;
      row.entry.unpushed = true;
      remaining--;
      if (remaining <= 0) break;
    }
  }

  async function _fetchPending(workspace: string) {
    const { ok, data } = await apiGet(
      wsEndpoint(workspace, `unpulled-log?limit=${gitStore.GIT_LOG_ENTRIES_PER_PAGE}&graph=true`),
    );
    if (!ok) return [];
    const rows = buildGitGraphRows(parseGitGraphOutput(data.stdout));
    for (const row of rows) {
      if (row.entry) row.entry.pending = true;
    }
    return rows;
  }

  async function loadHistory() {
    const handled = await withWorkspace(async (workspace) => {
      isHistoryLoading.value = true;
      hasMoreHistory.value = false;
      isLoadingMoreHistory.value = false;
      historyPage = 0;
      try {
        const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
        const [result, pendingRows] = await Promise.all([
          _fetchPage(workspace, perPage),
          _fetchPending(workspace),
        ]);
        if (result) {
          pendingGraphRows = pendingRows;
          _markUnpushed(result.rows);
          graphRows.value = [...pendingGraphRows, ...result.rows];
          hasMoreHistory.value = result.count >= perPage;
        }
      } catch (e) {
        console.error("git log load failed:", e);
      } finally {
        isHistoryLoading.value = false;
        nextTick(() => onHistoryListScroll());
      }
      return true;
    });
    if (!handled) isHistoryLoading.value = false;
  }

  async function loadMoreHistory() {
    if (isHistoryLoading.value || isLoadingMoreHistory.value || !hasMoreHistory.value) return;
    await withWorkspace(async (workspace) => {
      isLoadingMoreHistory.value = true;
      historyPage++;
      const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
      const totalLimit = (historyPage + 1) * perPage;
      try {
        const result = await _fetchPage(workspace, totalLimit);
        if (result) {
          _markUnpushed(result.rows);
          graphRows.value = [...pendingGraphRows, ...result.rows];
          hasMoreHistory.value = result.count >= totalLimit;
        }
      } catch (e) {
        console.error("git log loadMore failed:", e);
      } finally {
        isLoadingMoreHistory.value = false;
      }
    });
  }

  function onHistoryListScroll() {
    if (!hasMoreHistory.value || isHistoryLoading.value || isLoadingMoreHistory.value) return;
    const el = historyListEl.value;
    // 非表示・未レイアウト時は寸法 0 で常に「最下部」と誤判定し loadMore を連打するため除外する
    if (!el || el.clientHeight <= 0) return;
    const threshold = INFINITE_SCROLL_THRESHOLD_PX;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      loadMoreHistory();
    }
  }

  return {
    graphRows,
    commitEntries,
    graphWidth,
    isHistoryLoading,
    hasMoreHistory,
    isLoadingMoreHistory,
    historyListEl,
    loadHistory,
    loadMoreHistory,
    onHistoryListScroll,
  };
}
