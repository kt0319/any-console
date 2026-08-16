import { ref } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useConfirm } from "./useConfirm.ts";
import { useApi } from "./useApi.ts";
import { buildDetachedSessionList } from "../utils/detached-sessions.ts";
import { buildSessionTabParamsWithCache } from "./useSessionSync.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import {
  EP_TERMINAL_SESSIONS,
  EP_SYSTEM_TMUX_INFO,
  EP_SYSTEM_TMUX_ADOPT,
  EP_JOBS_WORKSPACES,
  terminalWsPath,
  terminalSessionDetachedPath,
} from "../utils/endpoints.ts";
import { emit } from "../app-bridge.ts";

// utils/detached-sessions.ts の DetachedSession 相当（非 export のためローカルに複製）。
type DetachedSession = {
  session_id: string | null,
  tmux_name: string,
  workspace: string | null,
  icon?: string,
  icon_color?: string,
  job_name?: string,
  job_label?: string,
  external: boolean,
};

// モジュールスコープの単一状態（useRecentJobs.tsと同じパターン）。
// WorkspaceOpen.vue（カテゴリ見出しのv-if判定用）とDetachedSessionsList.vue
// （一覧描画）の両方から呼ばれるため、呼び出しごとに別状態にならないよう
// 共有する。
const detachedSessions = ref<ReturnType<typeof buildDetachedSessionList>>([]);
const allJobsData = ref<Record<string, any>>({});

// Detached sessions（タブに紐付いていないtmuxセッション）の一覧取得・
// Open/Adopt操作。WorkspaceOpen.vueの「Detached Sessions」カテゴリから使う
// （以前はSessionListView.vueの一覧に続く折りたたみセクションだったが、
// 「セッションを開く」導線としてOpenタブに統合した）。
export function useDetachedSessions() {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const { confirm } = useConfirm();
  const { apiGet, apiPost, apiPut } = useApi();

  async function loadDetachedSessions() {
    const [tmuxRes, ownedRes, jobsRes] = await Promise.all([
      getWithRetry(apiGet, EP_SYSTEM_TMUX_INFO),
      getWithRetry(apiGet, EP_TERMINAL_SESSIONS),
      getWithRetry(apiGet, EP_JOBS_WORKSPACES),
    ]);
    allJobsData.value = jobsRes.ok && jobsRes.data ? jobsRes.data : {};
    const owned = ownedRes.ok && Array.isArray(ownedRes.data) ? ownedRes.data : [];
    const knownTabIds = new Set(terminalStore.openTabs.map((t) => t.sessionId).filter(Boolean));
    const all = tmuxRes.ok && Array.isArray(tmuxRes.data?.sessions) ? tmuxRes.data.sessions : [];
    const prefix = tmuxRes.ok && tmuxRes.data?.prefix ? tmuxRes.data.prefix : undefined;
    detachedSessions.value = buildDetachedSessionList(all, owned, knownTabIds, prefix);
  }

  function openDetached(s: DetachedSession) {
    const tab = terminalStore.addTerminalTab({
      // DetachedSession は buildSessionTabParams が要求する ws_url を持たないが、
      // 下の wsUrl 上書きで実際には使われない（session_id は !s.external の呼び出し元でのみ非 null）。
      ...buildSessionTabParamsWithCache(
        s as unknown as Parameters<typeof buildSessionTabParamsWithCache>[0],
        { workspaces: workspaceStore.allWorkspaces, allJobs: allJobsData.value },
      ),
      wsUrl: terminalWsPath(s.session_id!),
      jobLabel: s.job_label || (s.workspace || s.session_id),
      restored: false,
    });
    apiPut(terminalSessionDetachedPath(s.session_id!), { detached: false }).catch(() => {});
    emit("tab:select", { tab });
    loadDetachedSessions();
  }

  async function adoptDetached(s: DetachedSession) {
    // 外部 tmux セッションを ac- プレフィックスにリネームして any-console 管理化、
    // そのままタブとして開く。
    if (!await confirm(`Adopt "${s.tmux_name}" into any-console? The tmux session will be renamed.`)) return;
    const { ok, data } = await apiPost(EP_SYSTEM_TMUX_ADOPT, { name: s.tmux_name }, { errorMessage: "Failed to adopt session" });
    if (!ok || !data?.session_id) return;
    const tab = terminalStore.addTerminalTab({
      wsUrl: terminalWsPath(data.session_id),
      workspace: null,
      wsIcon: null,
      wsIconColor: null,
      icon: "mdi-console",
      iconColor: null,
      jobName: null,
      jobLabel: s.tmux_name,
      restored: false,
    });
    emit("tab:select", { tab });
    await loadDetachedSessions();
  }

  return { detachedSessions, loadDetachedSessions, openDetached, adoptDetached };
}
