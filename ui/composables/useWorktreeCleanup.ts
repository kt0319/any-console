import { useTerminalStore } from "../stores/terminal.ts";
import { useApi } from "./useApi.ts";
import { findOpenTabsForWorktree, baseWorkspaceName } from "../utils/worktree.ts";
import { EP_TERMINAL_SESSIONS, EP_PREVIEW_PORTS, EP_SYSTEM_PROCESS_KILL, terminalSessionPath } from "../utils/endpoints.ts";
import { emit } from "../app-bridge.ts";

/**
 * worktree 削除に伴う残骸（タブに紐付かない detached セッション・その worktree 内の dev server プロセス）を検出・掃除する。
 * タブを閉じるだけでは対処できないため findOpenTabsForWorktree と合わせて集約する。
 */
export function useWorktreeCleanup() {
  const terminalStore = useTerminalStore();
  const { apiGet, apiDelete, apiPost } = useApi();

  async function findResidue(
    wt?: { workspace?: string; name?: string; branch?: string; worktree_base?: string; worktree_branch?: string },
    wsWorkspaceName?: string,
  ) {
    const wsName = wsWorkspaceName || wt?.workspace || wt?.name;
    const openTabs = findOpenTabsForWorktree(terminalStore.openTabs, { workspace: wsName });
    if (!wsName) return { openTabs, detachedSessions: [] as any[], devServers: [] as any[] };

    // worktree_base/worktree_branch が取れる場合はそちらで比較する（dev server の workspace 値は cwd から推測されるため完全一致しないことがある）。
    // expectedBranch が取れない対象は workspace 完全一致。
    const expectedBranch = wt?.worktree_branch || wt?.branch;
    const expectedBase = wsName ? baseWorkspaceName(wsName) : wt?.worktree_base;

    const matchesTarget = (item: any) =>
      expectedBranch ? (item.worktree_base === expectedBase && item.worktree_branch === expectedBranch) : item.workspace === wsName;

    const openTabSessionIds = new Set(openTabs.map((t) => t.sessionId).filter(Boolean));
    const [sessionsRes, portsRes] = await Promise.all([apiGet(EP_TERMINAL_SESSIONS), apiGet(EP_PREVIEW_PORTS)]);
    const detachedSessions = (sessionsRes.ok && Array.isArray(sessionsRes.data) ? sessionsRes.data : [])
      .filter((s: any) => !openTabSessionIds.has(s.session_id) && matchesTarget(s));
    const devServers = (portsRes.ok && Array.isArray(portsRes.data) ? portsRes.data : [])
      .filter((p: any) => p.pid && matchesTarget(p));

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
