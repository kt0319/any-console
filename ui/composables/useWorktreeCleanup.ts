import { useTerminalStore } from "../stores/terminal.ts";
import { useApi } from "./useApi.ts";
import { findOpenTabsForWorktree } from "../utils/worktree.ts";
import { EP_TERMINAL_SESSIONS, EP_PREVIEW_PORTS, EP_SYSTEM_PROCESS_KILL, terminalSessionPath } from "../utils/endpoints.ts";
import { emit } from "../app-bridge.ts";

/**
 * worktree削除に伴う残骸（開いているタブ以外）を検出・掃除する。
 * - タブに紐付いていないdetachedセッション（terminalStore.openTabsには無いが
 *   /terminal/sessionsには残っている、そのworktree宛のtmuxセッション）
 * - そのworktree内で起動していたdev serverプロセス（/preview/portsで検出
 *   済みのpid、ディレクトリを消してもプロセス自体は生き残るため）
 * どちらも「タブを閉じる」だけでは対処できず、削除操作を跨いだこのタイミング
 * でしか一括で見つけられないため、findOpenTabsForWorktreeと合わせてここに
 * 集約する（useBranchActions.ts / WorkspaceOpen.vue の両方から使う）。
 */
export function useWorktreeCleanup() {
  const terminalStore = useTerminalStore();
  const { apiGet, apiDelete, apiPost } = useApi();

  async function findResidue(wt?: { workspace?: string; name?: string; branch?: string }, wsWorkspaceName?: string) {
    const wsName = wsWorkspaceName || wt?.workspace || wt?.name;
    const openTabs = findOpenTabsForWorktree(terminalStore.openTabs, { workspace: wsName });
    if (!wsName) return { openTabs, detachedSessions: [] as any[], devServers: [] as any[] };

    const openTabSessionIds = new Set(openTabs.map((t) => t.sessionId).filter(Boolean));
    const [sessionsRes, portsRes] = await Promise.all([apiGet(EP_TERMINAL_SESSIONS), apiGet(EP_PREVIEW_PORTS)]);
    const detachedSessions = (sessionsRes.ok && Array.isArray(sessionsRes.data) ? sessionsRes.data : [])
      .filter((s: any) => s.workspace === wsName && !openTabSessionIds.has(s.session_id));
    const devServers = (portsRes.ok && Array.isArray(portsRes.data) ? portsRes.data : [])
      .filter((p: any) => p.workspace === wsName && p.pid);

    return { openTabs, detachedSessions, devServers };
  }

  async function cleanupResidue({ openTabs, detachedSessions, devServers }: {
    openTabs: any[],
    detachedSessions: any[],
    devServers: any[],
  }) {
    for (const tab of openTabs) emit("tab:close", { tab });
    await Promise.all([
      ...detachedSessions.map((s) => apiDelete(terminalSessionPath(s.session_id)).catch(() => {})),
      ...devServers.map((p) => apiPost(EP_SYSTEM_PROCESS_KILL, { pid: p.pid }).catch(() => {})),
    ]);
  }

  return { findResidue, cleanupResidue };
}
