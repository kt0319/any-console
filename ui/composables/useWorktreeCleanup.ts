import { useTerminalStore } from "../stores/terminal.ts";
import { useApi } from "./useApi.ts";
import { findOpenTabsForWorktree, baseWorkspaceName } from "../utils/worktree.ts";
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

  async function findResidue(
    wt?: { workspace?: string; name?: string; branch?: string; worktree_base?: string; worktree_branch?: string },
    wsWorkspaceName?: string,
  ) {
    const wsName = wsWorkspaceName || wt?.workspace || wt?.name;
    const openTabs = findOpenTabsForWorktree(terminalStore.openTabs, { workspace: wsName });
    if (!wsName) return { openTabs, detachedSessions: [] as any[], devServers: [] as any[] };

    // サーバ側のworktree_base/worktree_branchが取れる場合はそちらで比較する
    // （workspace文字列の完全一致より安全。dev serverのworkspace値はcwdから
    // 都度推測されるためcolon形式の文字列が完全一致しない場合がある）。
    // worktreeでない対象（expectedBranchが取れない）は従来通りworkspace完全一致。
    const expectedBranch = wt?.worktree_branch || wt?.branch;
    const expectedBase = wsName ? baseWorkspaceName(wsName) : wt?.worktree_base;

    const openTabSessionIds = new Set(openTabs.map((t) => t.sessionId).filter(Boolean));
    const [sessionsRes, portsRes] = await Promise.all([apiGet(EP_TERMINAL_SESSIONS), apiGet(EP_PREVIEW_PORTS)]);
    const detachedSessions = (sessionsRes.ok && Array.isArray(sessionsRes.data) ? sessionsRes.data : [])
      .filter((s: any) =>
        !openTabSessionIds.has(s.session_id) &&
        (expectedBranch ? (s.worktree_base === expectedBase && s.worktree_branch === expectedBranch) : s.workspace === wsName));
    const devServers = (portsRes.ok && Array.isArray(portsRes.data) ? portsRes.data : [])
      .filter((p: any) =>
        p.pid &&
        (expectedBranch ? (p.worktree_base === expectedBase && p.worktree_branch === expectedBranch) : p.workspace === wsName));

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
