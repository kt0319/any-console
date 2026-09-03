import { defineStore } from "pinia";
import { ref, reactive, computed, markRaw } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { LS_KEY_ACTIVE_SESSION } from "../utils/constants.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { isTouchInput } from "../utils/device.ts";
import { findUrlInBuffer, TERMINAL_URL_REGEX } from "../utils/terminal-buffer-text.ts";
import { EP_TERMINAL_ORDER, terminalSessionDetachedPath } from "../utils/endpoints.ts";
import { useAuthStore } from "./auth.ts";
import { useAgentStateStore } from "./agent-state.ts";
import { useTerminalSettingsStore } from "./terminal-settings.ts";

let _longPressActive = false;
export function setLongPressActive(v: boolean) { _longPressActive = !!v; }

export interface TerminalTab {
  id: number;
  sessionId: string;
  wsUrl: string;
  workspace: string | null;
  label: string;
  wsIcon: { name: string, color: string | null } | null;
  icon: { name: string, color: string | null } | null;
  jobName: string | null;
  jobLabel: string | null;
  term: Terminal | null;
  fitAddon: FitAddon;
  ws: WebSocket | null;
  _createdAt: number;
  _pendingOpen: boolean;
  _pendingRedraw: boolean;
  _needsHistoryRestore: boolean;
  _wsDisposed: boolean;
  _reconnectAttempts: number;
  _reconnectTimer: ReturnType<typeof setTimeout> | null;
  _activityTimer: ReturnType<typeof setTimeout> | null;
  _inputBound: boolean;
  _elementBound: boolean;
  // 以下は生成後に composables（useTerminal / useTerminalResize / useTerminalInput 等）が
  // 実行時に付与するフィールド。
  _activity?: boolean;
  _connecting?: boolean;
  _frameResizeObserver?: ResizeObserver | null;
  _lastFitCols?: number;
  _lastFitRows?: number;
  _lastSendAt?: number;
  _lastWriteAt?: number;
  _postWriteRefresh?: ReturnType<typeof setTimeout> | null;
  _releaseInput?: (() => void) | null;
  _writeCount?: number;
}

export const useTerminalStore = defineStore("terminal", () => {
  const openTabs = ref<TerminalTab[]>([]);
  const activeTabId = ref<number | null>(null);
  // アクティブなタブ（`openTabs.find(...)` の定型を一本化）。tab は markRaw の
  // ため、この computed はタブの切替・開閉にのみ反応する（フィールド変更には
  // 反応しない — インラインで find していた従来と同じ性質）。
  const activeTab = computed(() => openTabs.value.find((t) => t.id === activeTabId.value));
  const terminalIdCounter = ref(0);
  const hasRestoredTabsFromStorage = ref(false);
  const restoreSessionsLoading = ref(false);
  const restoreSessionsError = ref("");
  const tabFlags = reactive<Record<number, Record<string, unknown>>>({});
  // tab は markRaw（xterm.Terminal/WebSocket等の重い実行時参照を保持するため意図的に
  // 非リアクティブ）なので、tab.workspace 等のフィールド変更は画面に伝わらない。tab
  // オブジェクト自体を差し替えるとconnectTerminalWs等がidentityをクロージャで握っている
  // ため実行時状態が分裂して壊れる。identityは変えず、この版数を依存に含めて再計算を
  // トリガーする。
  const tabWorkspaceVersion = ref(0);
  // closeTab がローカル除去済み・サーバー削除リクエスト未完了の sessionId。
  // syncSessionsFromServer のポーリングがこの間隙でタブを復活させるのを防ぐ。
  const pendingCloseSessionIds = ref(new Set<string>());
  // switchTab(tabId, { focus: false }) の直後、TerminalPane の isActive watcher が
  // 無条件で term.focus() してしまうのを一度だけ抑止するための one-shot フラグ。
  const suppressNextFocus = ref(false);

  function markPendingClose(sessionId: string) {
    if (!sessionId) return;
    pendingCloseSessionIds.value.add(sessionId);
  }

  function clearPendingClose(sessionId: string) {
    if (!sessionId) return;
    pendingCloseSessionIds.value.delete(sessionId);
  }
  function setTabFlag(tabId: number, key: string, value: unknown) {
    if (!tabFlags[tabId]) tabFlags[tabId] = {};
    tabFlags[tabId][key] = value;
  }

  function clearTabFlags(tabId: number) {
    delete tabFlags[tabId];
  }

  // 同一 session_id のタブ追加は必ずここで弾く。呼び出し側はそれぞれ独立した非同期処理で
  // 「既存タブが無いか」を確認してから呼ぶが、確認から呼び出しまでのawaitの間に別経路が
  // 同じセッションのタブを追加してしまうレースがあるため、store側の唯一の追加窓口でチェックする。
  function addTerminalTab({ wsUrl, workspace, wsIcon, wsIconColor, icon, iconColor, jobName, jobLabel, restored }: {
    wsUrl: string,
    workspace?: string | null,
    wsIcon?: string | null,
    wsIconColor?: string | null,
    icon?: string | null,
    iconColor?: string | null,
    jobName?: string | null,
    jobLabel?: string | null,
    restored?: boolean,
  }) {
    const sessionId = wsUrl.replace(/.*\/terminal\/ws\//, "").replace(/\?.*/, "");
    const existing = openTabs.value.find((t) => t.sessionId === sessionId);
    if (existing) return existing;

    const opts = useTerminalSettingsStore().getTerminalRuntimeOptions();
    const term = new Terminal({ ...opts, allowProposedApi: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((e, uri) => {
      if (isTouchInput() && !_longPressActive) return;
      // WebLinksAddon はアプリ側が明示的に改行したURLを連結できず途中で切れることがあるため、
      // クリック座標から改めて全体を再計算する。
      const fullUri = findUrlInBuffer(term, e.clientX, e.clientY) || uri;
      bridgeEmit("terminal:url", { uri: fullUri });
    }, {
      // デフォルトの内蔵regexはhttp(s)://のみでwww.始まりのURLを認識しない
      // （findUrlInBuffer側のTERMINAL_URL_REGEXと合わせる。gフラグはWebLinksAddon側で
      // 重複付与するためsourceのみ渡す）。
      urlRegex: new RegExp(TERMINAL_URL_REGEX.source),
    }));

    const id = ++terminalIdCounter.value;
    const label = jobLabel || workspace || "terminal";

    const tab = markRaw({
      id,
      sessionId,
      wsUrl,
      workspace: workspace || null,
      label,
      wsIcon: wsIcon ? { name: wsIcon, color: wsIconColor || null } : null,
      icon: icon ? { name: icon, color: iconColor || null } : null,
      jobName: jobName || null,
      jobLabel: jobLabel || null,
      term,
      fitAddon,
      ws: null,
      _createdAt: Date.now(),
      _pendingOpen: true,
      _pendingRedraw: !!restored,
      _needsHistoryRestore: !!restored,
      _wsDisposed: false,
      _reconnectAttempts: 0,
      _reconnectTimer: null,
      _activityTimer: null,
      _inputBound: false,
      _elementBound: false,
    });

    openTabs.value.push(tab);
    return tab;
  }

  function removeTab(tabId: number) {
    const idx = openTabs.value.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = openTabs.value[idx];
    if (tab.term) {
      try { tab.term.dispose(); } catch {}
      tab.term = null;
    }
    openTabs.value.splice(idx, 1);
    if (activeTabId.value === tabId) pickActiveAfter(idx);
  }

  // idx 位置以降で最初のタブ（無ければ末尾）へ active を移す。
  function pickActiveAfter(idx: number) {
    const tabs = openTabs.value;
    const next = tabs.find((_, i) => i >= idx) || tabs[tabs.length - 1];
    activeTabId.value = next ? next.id : null;
    if (next) useAgentStateStore().clearDoneState(next.sessionId);
  }

  function switchTab(tabId: number, { focus = true }: { focus?: boolean } = {}) {
    activeTabId.value = tabId;
    if (!focus) suppressNextFocus.value = true;
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (tab) {
      localStorage.setItem(LS_KEY_ACTIVE_SESSION, tab.sessionId);
      useAgentStateStore().clearSessionNotifyBadges(tab.sessionId);
    }
  }

  function detachTab(tabId: number) {
    const idx = openTabs.value.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = openTabs.value[idx];
    if (tab.term) {
      try { tab.term.dispose(); } catch {}
      tab.term = null;
    }
    openTabs.value = openTabs.value.filter((t) => t.id !== tabId);
    if (activeTabId.value === tabId) pickActiveAfter(idx);
    if (tab.sessionId) {
      const auth = useAuthStore();
      auth.apiFetch(terminalSessionDetachedPath(tab.sessionId), {
        method: "PUT", body: { detached: true },
      }).catch(() => {});
    }
  }

  /**
   * @param iconInfo 紐付け先ワークスペースのアイコン。渡すとタブバー等のアイコン（tab.wsIcon）
   *   も即座に切り替わる（未指定時はワークスペース名のみ更新。呼び出し側がアイコン解決できない
   *   場合はnullを渡してアイコンを変えない）。
   */
  function setTabWorkspace(tabId: number, workspaceName: string | null, iconInfo: { icon?: string, iconColor?: string } | null = null) {
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (!tab) return;
    tab.workspace = workspaceName || null;
    if (iconInfo) {
      tab.wsIcon = iconInfo.icon ? { name: iconInfo.icon, color: iconInfo.iconColor || null } : null;
    }
    // tab の identity は変えず、tabWorkspaceVersion を進めることで
    // 依存側（TerminalPane 等）に変更を伝える。
    tabWorkspaceVersion.value++;
  }

  /**
   * @param iconInfo 紐付け先ジョブのアイコン。渡すとタブのjob側アイコン
   *   （tab.icon）も即座に切り替わる（setTabWorkspaceのworkspace版と同じ役割）。
   */
  function setTabJob(tabId: number, jobName: string | null, jobLabel: string | null, iconInfo: { icon?: string | null, iconColor?: string | null } | null = null) {
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (!tab) return;
    tab.jobName = jobName || null;
    tab.jobLabel = jobLabel || null;
    if (iconInfo?.icon) {
      tab.icon = { name: iconInfo.icon, color: iconInfo.iconColor || null };
    }
    tabWorkspaceVersion.value++;
  }

  /**
   * ワークスペース・ジョブいずれにも紐付かないベアターミナルのタブ名を
   * 差し替える（cwd照合で自動紐付けされる前提の setTabWorkspace/setTabJob と
   * 異なり、呼び出し側が用意した文字列をそのまま入れるだけ）。
   */
  function setTabLabel(tabId: number, label: string) {
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (!tab || !label || tab.label === label) return;
    tab.label = label;
    tabWorkspaceVersion.value++;
  }

  function moveTab(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= openTabs.value.length) return;
    if (toIndex < 0 || toIndex >= openTabs.value.length) return;
    const [tab] = openTabs.value.splice(fromIndex, 1);
    openTabs.value.splice(toIndex, 0, tab);
    saveTabOrder();
  }

  async function saveTabOrder() {
    const order = openTabs.value.map((t) => t.sessionId);
    try {
      const auth = useAuthStore();
      await auth.apiFetch(EP_TERMINAL_ORDER, { method: "PUT", body: { order } });
    } catch { /* ignore */ }
  }

  async function loadTabOrder() {
    try {
      const auth = useAuthStore();
      const res = await auth.apiFetch(EP_TERMINAL_ORDER);
      if (!res || !res.ok) return [];
      const data = await res.json().catch(() => null);
      const order = data?.order;
      return Array.isArray(order) ? order.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  }

  return {
    openTabs,
    activeTabId,
    activeTab,
    hasRestoredTabsFromStorage,
    restoreSessionsLoading,
    restoreSessionsError,
    tabFlags,
    pendingCloseSessionIds,
    suppressNextFocus,
    markPendingClose,
    clearPendingClose,
    setTabFlag,
    clearTabFlags,
    addTerminalTab,
    removeTab,
    switchTab,
    detachTab,
    moveTab,
    setTabWorkspace,
    setTabJob,
    setTabLabel,
    tabWorkspaceVersion,
    loadTabOrder,
  };
});
