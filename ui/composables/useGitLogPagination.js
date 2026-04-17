import { ref, computed, nextTick } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { useApi } from "./useApi.js";
import { parseGitGraphOutput, buildGitGraphRows, computeGraphWidth } from "../utils/git-graph.js";
import { INFINITE_SCROLL_THRESHOLD_PX } from "../utils/constants.js";

export function useGitLogPagination() {
  const workspaceStore = useWorkspaceStore();
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

  async function loadHistory() {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) { isHistoryLoading.value = false; return; }
    isHistoryLoading.value = true;
    hasMoreHistory.value = false;
    isLoadingMoreHistory.value = false;
    historyPage = 0;
    try {
      const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
      const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${perPage}&skip=0&graph=true`));
      if (!ok) { isHistoryLoading.value = false; return; }
      const parsed = parseGitGraphOutput(data.stdout);
      graphRows.value = buildGitGraphRows(parsed);
      hasMoreHistory.value = parsed.filter((p) => p.entry).length >= perPage;
    } catch (e) {
      console.error("git log load failed:", e);
    } finally {
      isHistoryLoading.value = false;
      nextTick(() => onHistoryListScroll());
    }
  }

  async function loadMoreHistory() {
    if (isHistoryLoading.value || isLoadingMoreHistory.value || !hasMoreHistory.value) return;
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    isLoadingMoreHistory.value = true;
    historyPage++;
    const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
    const totalLimit = (historyPage + 1) * perPage;
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${totalLimit}&skip=0&graph=true`));
      if (!ok) return;
      const parsed = parseGitGraphOutput(data.stdout);
      graphRows.value = buildGitGraphRows(parsed);
      hasMoreHistory.value = parsed.filter((p) => p.entry).length >= totalLimit;
    } catch (e) {
      console.error("git log loadMore failed:", e);
    } finally {
      isLoadingMoreHistory.value = false;
      nextTick(() => onHistoryListScroll());
    }
  }

  function onHistoryListScroll() {
    if (!hasMoreHistory.value || isHistoryLoading.value || isLoadingMoreHistory.value) return;
    const el = historyListEl.value;
    if (!el) return;
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
