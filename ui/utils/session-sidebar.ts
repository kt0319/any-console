import { dispatchWorkspaceLabel } from "./dispatch-request.ts";
import { groupTabsByBaseWorkspace } from "./worktree.ts";
import { buildPillFields, type PillFieldsContext } from "./pill-fields.ts";

/** 色のみで状態を示さないためアイコンとラベルを併記する。idle はバッジを出さない。 */
export const AGENT_STATE_META = Object.freeze({
  working: Object.freeze({ icon: "mdi-autorenew", label: "Working", className: "agent-state-working" }),
  blocked: Object.freeze({ icon: "mdi-alert-circle-outline", label: "Blocked", className: "agent-state-blocked" }),
  done: Object.freeze({ icon: "mdi-check-circle-outline", label: "Done", className: "agent-state-done" }),
});

/** idle は done でない限り null。 */
export function resolveAgentBadgeState(rawState?: string, isDone?: boolean): string | null {
  if (isDone) return "done";
  if (!rawState || rawState === "idle") return null;
  return rawState;
}

export function agentStateDescriptor(state?: string | null): { icon: string; label: string; className: string } | null {
  return (state && AGENT_STATE_META[state as keyof typeof AGENT_STATE_META]) || null;
}

/** TabBar と同じく autoDiscovered を除外し、openTabs の順で並べる。 */
export function sessionSidebarItems(
  tabs: any[],
  workspaces: any[],
  ctx: PillFieldsContext & {
    tabFlags?: Record<string | number, any>;
    agentStates?: Record<string, string>;
    doneSessions?: Record<string, boolean>;
    phraseNotifySessions?: Record<string, boolean>;
  } = {},
) {
  const { tabFlags = {}, agentStates = {}, doneSessions = {}, phraseNotifySessions = {} } = ctx;
  const rows = (tabs || [])
    .filter((tab) => !tabFlags[tab.id]?.autoDiscovered)
    .map((tab) => {
      const ws = tab.workspace ? (workspaces || []).find((w) => w.name === tab.workspace) : undefined;
      // worktree 行はブランチを下段で別表示するためベース名のみ。ベアターミナルは「[terminal] パス名」。
      const bareTerminalLabel = tab.label ? `[terminal] ${tab.label}` : "[terminal]";
      const label = ws?.worktree ? (ws.worktree_base || ws.name || "") : (tab.workspace || bareTerminalLabel);
      const pill = buildPillFields(tab.workspace, ws, ctx);
      return {
        tab,
        id: tab.id,
        sessionId: tab.sessionId,
        label,
        icon: tab.wsIcon || tab.icon || null,
        // ワークスペースアイコンとジョブアイコンは別枠で併記する（TabItem.vue と同じ）。
        wsIcon: tab.wsIcon || null,
        jobIcon: tab.icon || null,
        isWorktree: !!ws?.worktree,
        ...pill,
        agent: agentStateDescriptor(resolveAgentBadgeState(agentStates[tab.sessionId], !!doneSessions[tab.sessionId])),
        phraseNotify: !!phraseNotifySessions[tab.sessionId],
        inGroup: false,
        groupLast: false,
        compact: false,
      };
    });
  for (const group of groupTabsByBaseWorkspace(rows)) {
    if (group.items.length < 2) continue;
    for (const row of group.items) row.inGroup = true;
    group.items[group.items.length - 1].groupLast = true;
    // グループの先頭行がワークスペース名を出すので、2行目以降のworktreeは名前の行を省いて1行にする。
    for (const row of group.items.slice(1)) row.compact = row.isWorktree;
  }
  return rows;
}

/** タブが無いワークスペースの承認待ち dispatch を、セッション行と同じピル情報で出す行データ。 */
export function pendingDispatchSidebarItems(
  workspaces: any[],
  openTabWorkspaceNames: Set<string>,
  ctx: Parameters<typeof sessionSidebarItems>[2] = {},
) {
  const { dispatchQueue = [] } = ctx;
  const names = new Set<string>();
  for (const item of dispatchQueue) {
    const wsName = dispatchWorkspaceLabel(item.request);
    if (wsName && !openTabWorkspaceNames.has(wsName)) names.add(wsName);
  }
  return Array.from(names).map((wsName) => {
    const ws = (workspaces || []).find((w) => w.name === wsName);
    const pill = buildPillFields(wsName, ws, ctx);
    return {
      workspace: wsName,
      label: ws?.worktree ? (ws.worktree_base || ws.name || wsName) : wsName,
      wsIcon: ws?.icon ? { name: ws.icon, color: ws.icon_color } : null,
      jobIcon: null,
      isWorktree: !!ws?.worktree,
      agent: { icon: "mdi-inbox-arrow-down-outline", label: "Pending", className: "agent-state-dispatch-pending" },
      phraseNotify: false,
      ...pill,
    };
  });
}
