import { ref, computed, nextTick } from "vue";
import { useGitStore } from "../stores/git.js";
import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { parseGitGraphOutput, buildGitGraphRows, computeGraphWidth } from "../utils/git-graph.js";
import { INFINITE_SCROLL_THRESHOLD_PX } from "../utils/constants.js";

export function useGitLogPagination() {
  const { withWorkspace } = useWorkspace();
  const gitStore = useGitStore();
  const { apiGet, wsEndpoint } = useApi();

  const graphRows = ref([]);
  const commitEntries = computed(() => graphRows.value.filter((r) => r.entry).map((r) => r.entry));
  const graphWidth = computed(() => computeGraphWidth(graphRows.value));
  const isHistoryLoading = ref(true);
  const hasMoreHistory = ref(false);
  const isLoadingMoreHistory = ref(false);
  const historyListEl = ref(null);
  let historyPage = 0;

  async function _fetchPage(workspace, limit) {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${limit}&skip=0&graph=true`));
    if (!ok) return null;
    const parsed = parseGitGraphOutput(data.stdout);
    return { rows: buildGitGraphRows(parsed), count: parsed.filter((p) => p.entry).length };
  }

  async function loadHistory() {
    const handled = await withWorkspace(async (workspace) => {
      isHistoryLoading.value = true;
      hasMoreHistory.value = false;
      isLoadingMoreHistory.value = false;
      historyPage = 0;
      try {
        const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
        const result = await _fetchPage(workspace, perPage);
        if (result) {
          graphRows.value = result.rows;
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
          graphRows.value = result.rows;
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
    // 非表示・未レイアウト時は scrollHeight/clientHeight が 0 になり、
    // 常に「最下部」と誤判定して loadMore を連打してしまうため除外する。
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
