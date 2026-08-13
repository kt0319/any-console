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
  // loadHistory時にのみ取得し、loadMoreHistoryのページ追加では消えないよう
  // 先頭に付け直す（pending行はページングと無関係な固定の小集合のため）。
  let pendingGraphRows: GitGraphRow[] = [];

  async function _fetchPage(workspace: string, limit: number) {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${limit}&skip=0&graph=true`));
    if (!ok) return null;
    const parsed = parseGitGraphOutput(data.stdout);
    return { rows: buildGitGraphRows(parsed), count: parsed.filter((p) => p.entry).length };
  }

  // upstream にはあるがまだ pull していないコミット（HEAD..@{u}）を、
  // Historyペインの先頭に非アクティブ表示するために取得する。upstream 未設定の
  // ワークスペースでは空配列（サーバ側が空stdoutを返す）。取得失敗はHistory本体の
  // 表示を妨げないよう握りつぶす（[]を返すだけ）。
  // ahead 件数（現在ブランチが upstream より進んでいる = 未pushのコミット数）分だけ、
  // 履歴先頭から entry.unpushed を付与する。git-log は HEAD から新しい順に並ぶため、
  // 先頭の ahead 件が未push分と一致する。upstream 未設定/pushしていないローカルブランチも
  // ahead に含まれる（canPush 相当の定義に合わせる）。
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
