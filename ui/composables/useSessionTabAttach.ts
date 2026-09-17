import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { buildSessionTabParamsWithCache } from "./useSessionSync.ts";
import { EP_JOBS_WORKSPACES, EP_TERMINAL_SESSIONS } from "../utils/endpoints.ts";
import { emit } from "../app-bridge.ts";

/**
 * 既存のサーバセッションをタブとして選択する（開いていなければ一覧を取得してタブを作る）。
 * ディープリンクの ?session= と Dispatch 実行後のフォーカスで共用する。
 * 既存タブでも tab:select を発火する（設定モーダル等の自動クローズが購読しているため）。
 */
export function useSessionTabAttach() {
  const { apiGet } = useApi();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();

  async function attachSessionTab(
    sessionId: string,
    { restored, workspace }: { restored: boolean, workspace?: string },
  ): Promise<{ tab: TerminalTab, created: boolean } | null> {
    const existing = terminalStore.openTabs.find((t) => t.sessionId === sessionId);
    if (existing) {
      emit("tab:select", { tab: existing });
      return { tab: existing, created: false };
    }
    const [sessionsRes, jobsRes] = await Promise.all([
      getWithRetry(apiGet, EP_TERMINAL_SESSIONS),
      getWithRetry(apiGet, EP_JOBS_WORKSPACES),
    ]);
    if (!sessionsRes.ok || !Array.isArray(sessionsRes.data)) return null;
    const meta = sessionsRes.data.find((s) => s.session_id === sessionId);
    if (!meta) return null;
    if (workspace) workspaceStore.selectedWorkspace = workspace;
    const allJobs = jobsRes.ok && jobsRes.data ? jobsRes.data : {};
    const tab = terminalStore.addTerminalTab({
      ...buildSessionTabParamsWithCache(meta, { workspaces: workspaceStore.allWorkspaces, allJobs }),
      restored,
    });
    emit("tab:select", { tab });
    return { tab, created: true };
  }

  return { attachSessionTab };
}
