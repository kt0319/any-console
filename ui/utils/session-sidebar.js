import { workspaceDisplayName } from "./worktree.js";

// セッションサイドバー（TabBar のハンバーガーから開く一覧）の表示行を
// 組み立てる純粋関数群。SessionSidebar.vue から使う。

/**
 * エージェント状態（terminalStore.agentStates の値）ごとの表示メタ。
 * 色のみで状態を示さないため、アイコンとラベルを必ず併記する。
 */
export const AGENT_STATE_META = Object.freeze({
  working: Object.freeze({ icon: "mdi-autorenew", label: "Working", className: "agent-state-working" }),
  blocked: Object.freeze({ icon: "mdi-alert-circle-outline", label: "Blocked", className: "agent-state-blocked" }),
  done: Object.freeze({ icon: "mdi-check-circle-outline", label: "Done", className: "agent-state-done" }),
  idle: Object.freeze({ icon: "mdi-sleep", label: "Idle", className: "agent-state-idle" }),
});

/**
 * エージェント状態の表示メタを返す（未知・未設定の状態は null）。
 * @param {string} [state]
 * @returns {{ icon: string, label: string, className: string } | null}
 */
export function agentStateDescriptor(state) {
  return (state && AGENT_STATE_META[state]) || null;
}

/**
 * サイドバーの表示行を組み立てる。TabBar と同じく autoDiscovered なタブは
 * 除外し、並び順も openTabs のまま（タブバーと一致）にする。
 * @param {any[]} tabs terminalStore.openTabs
 * @param {any[]} workspaces workspaceStore.allWorkspaces
 * @param {{ tabFlags?: Record<string|number, any>, agentStates?: Record<string, string>, phraseNotifySessions?: Record<string, boolean> }} [ctx]
 */
export function sessionSidebarItems(tabs, workspaces, ctx = {}) {
  const { tabFlags = {}, agentStates = {}, phraseNotifySessions = {} } = ctx;
  return (tabs || [])
    .filter((tab) => !tabFlags[tab.id]?.autoDiscovered)
    .map((tab) => {
      const ws = tab.workspace ? (workspaces || []).find((w) => w.name === tab.workspace) : undefined;
      const label = ws?.worktree ? workspaceDisplayName(ws) : (tab.workspace || tab.label || "terminal");
      return {
        tab,
        id: tab.id,
        sessionId: tab.sessionId,
        label,
        icon: tab.wsIcon || tab.icon || null,
        isWorktree: !!ws?.worktree,
        branch: ws?.branch || "",
        dirty: ws?.clean === false,
        ahead: ws?.ahead || 0,
        behind: ws?.behind || 0,
        changedFiles: ws?.changed_files || 0,
        insertions: ws?.insertions || 0,
        deletions: ws?.deletions || 0,
        agent: agentStateDescriptor(agentStates[tab.sessionId]),
        phraseNotify: !!phraseNotifySessions[tab.sessionId],
      };
    });
}
