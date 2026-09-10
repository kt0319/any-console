import { ref, computed, type Ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { mapGitHubPR, mapGitHubRun } from "../utils/github-runs.ts";
import { type AsyncState, asyncError, asyncLoading, asyncReady } from "../utils/async-state.ts";

const _countCache: Record<string, number> = {};

export function getCachedCount(workspace: string, key: string): number | null {
  const c = _countCache[`${workspace}:${key}`];
  return c ?? null;
}

function setCountCache(workspace: string, key: string, count: number) {
  _countCache[`${workspace}:${key}`] = count;
}

// テキスト記号（✓/✗/◗等）はフォント・OSで字形がぶれるうえ、in_progress/queued/
// waitingが同じ半円記号を共用しており見分けが付かないという指摘があった。
// mdiアイコン（他のステータス表示、例: AGENT_STATE_META/session-sidebar.ts と
// 同じ語彙）に揃え、実行中(in_progress)だけspinアニメーションを付けて
// 「待機中」と「実行中」を視覚的にも区別する。
const RUN_STATUS: Record<string, { icon: string, cls: string }> = {
  success: { icon: "mdi-check-circle-outline", cls: "github-run-success" },
  failure: { icon: "mdi-close-circle-outline", cls: "github-run-failure" },
  cancelled: { icon: "mdi-minus-circle-outline", cls: "github-run-cancelled" },
  in_progress: { icon: "mdi-autorenew", cls: "github-run-progress github-run-spin" },
  queued: { icon: "mdi-clock-outline", cls: "github-run-progress" },
  waiting: { icon: "mdi-clock-outline", cls: "github-run-progress" },
};

export function runStatusIcon(status: string) {
  return RUN_STATUS[status]?.icon || "mdi-help-circle-outline";
}

export function runStatusClass(status: string) {
  return RUN_STATUS[status]?.cls || "github-run-unknown";
}

// GitHub本家のissue一覧アイコン（issue-opened/issue-closed octicon）に合わせた
// 状態別の色。closedは基本 gh issue list --json では取得対象外（デフォルトopen
// のみ）だが、将来closedも表示する場合に備えて分岐しておく。
export function issueStateColor(state: string): string {
  return state === "closed" ? "var(--purple)" : "var(--success)";
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  author: string;
  labels: Array<{ name: string, color?: string }>;
  commentCount: number;
  createdAt: string | null;
}

export function labelStyle(color: string | null | undefined) {
  if (!color) return {};
  const c = color.replace(/^#/, "");
  return {
    backgroundColor: `#${c}33`,
    color: `#${c}`,
    border: `1px solid #${c}66`,
  };
}

export function useGitHub() {
  const workspaceStore = useWorkspaceStore();
  const { apiGet, wsEndpoint } = useApi();

  const githubUrl = ref("");

  const repoName = computed(() => {
    if (!githubUrl.value) return "";
    const m = githubUrl.value.match(/github\.com\/(.+?)(?:\.git)?$/);
    return m ? m[1] : githubUrl.value;
  });

  function loadWorkspaceGitHubUrl() {
    const ws = workspaceStore.currentWorkspace;
    githubUrl.value = ws?.github_url || "";
    return githubUrl.value;
  }

  async function _loadList<T>(
    endpoint: string,
    countKey: string,
    mapper: (item: any) => T,
    stateRef: Ref<AsyncState<T[]>>,
  ) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    stateRef.value = asyncLoading();
    try {
      const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, endpoint));
      if (!ok) { stateRef.value = asyncError("Failed to fetch"); return; }
      if (data.status !== "ok") { stateRef.value = asyncError(data.message || "Failed to fetch"); return; }
      const result = (data.data || []).map(mapper);
      stateRef.value = asyncReady(result);
      setCountCache(workspace, countKey, result.length);
    } catch (e) {
      stateRef.value = asyncError(e instanceof Error ? e.message : String(e));
    }
  }

  function _makeLoader<T>(endpoint: string, countKey: string, mapper: (item: any) => T) {
    return (stateRef: Ref<AsyncState<T[]>>) => _loadList(endpoint, countKey, mapper, stateRef);
  }

  const mapIssue = (item: any): GitHubIssue => ({
    number: item.number,
    title: item.title,
    state: String(item.state || "").toLowerCase(),
    author: item.author?.login || "",
    labels: item.labels || [],
    commentCount: item.comments?.length || 0,
    createdAt: item.createdAt || null,
  });

  // issueFilter: "open"(既定) | "closed" | "all"。IssuesQuery（server/src/github.rs）に
  // クエリ文字列で渡す。countCache（getCachedCount経由で他画面のIssuesバッジ等が参照）は
  // 「open issue数」を表す前提のため、open以外のフィルタでは別キーに逃がして上書きしない。
  function loadIssues(issueFilter: string = "open") {
    const countKey = issueFilter === "open" ? "issues" : `issues:${issueFilter}`;
    return _makeLoader(`github/issues?state=${issueFilter}`, countKey, mapIssue);
  }

  const loadPRs = _makeLoader("github/pulls", "prs", mapGitHubPR);

  const loadActions = _makeLoader("github/runs", "actions", mapGitHubRun);

  return { githubUrl, repoName, loadWorkspaceGitHubUrl, loadIssues, loadPRs, loadActions };
}
