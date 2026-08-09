import { defineStore } from "pinia";
import { ref, reactive, markRaw } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { LS_KEY_TERMINAL_SETTINGS, LS_KEY_ACTIVE_SESSION } from "../utils/constants.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { TERMINAL_SETTINGS_META, DEFAULT_TERMINAL_SETTINGS, sanitizeTerminalSetting, sanitizeTerminalSettings } from "../utils/terminal-settings.js";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.js";
import { isTouchInput } from "../utils/device.js";
import { findUrlInBuffer, TERMINAL_URL_REGEX } from "../utils/terminal-buffer-text.js";
import { EP_TERMINAL_ORDER, terminalSessionDetachedPath } from "../utils/endpoints.js";
import { useAuthStore } from "./auth.js";

const TERMINAL_SETTINGS_KEY = LS_KEY_TERMINAL_SETTINGS;

let _longPressActive = false;
export function setLongPressActive(v) { _longPressActive = !!v; }

function loadTerminalSettingsFromStorage() {
  return sanitizeTerminalSettings(safeJsonLoad(TERMINAL_SETTINGS_KEY, {}));
}

/**
 * @typedef {Object} TerminalTab
 * @property {number} id
 * @property {string} sessionId
 * @property {string} wsUrl
 * @property {string|null} workspace
 * @property {string} label
 * @property {{name: string, color: string|null}|null} wsIcon
 * @property {{name: string, color: string|null}|null} icon
 * @property {string|null} jobName
 * @property {string|null} jobLabel
 * @property {import("@xterm/xterm").Terminal|null} term
 * @property {import("@xterm/addon-fit").FitAddon} fitAddon
 * @property {WebSocket|null} ws
 * @property {number} _createdAt
 * @property {boolean} _pendingOpen
 * @property {boolean} _pendingRedraw
 * @property {boolean} _needsHistoryRestore
 * @property {boolean} _wsDisposed
 * @property {number} _reconnectAttempts
 * @property {ReturnType<typeof setTimeout>|null} _reconnectTimer
 * @property {ReturnType<typeof setTimeout>|null} _activityTimer
 * @property {boolean} _inputBound
 * @property {boolean} _elementBound
 */

export const useTerminalStore = defineStore("terminal", () => {
  const openTabs = ref(/** @type {TerminalTab[]} */ ([]));
  const activeTabId = ref(/** @type {number|null} */ (null));
  const terminalIdCounter = ref(0);
  const hasRestoredTabsFromStorage = ref(false);
  const restoreSessionsLoading = ref(false);
  const restoreSessionsError = ref("");
  const terminalSettings = ref(loadTerminalSettingsFromStorage());
  const tabFlags = reactive({});
  // tab は markRaw（xterm.Terminal/WebSocket等の重い実行時参照を保持するため
  // 意図的に非リアクティブ）なので、tab.workspace のようなフィールドの変更は
  // それ単体では画面に伝わらない。かといって tab オブジェクト自体を差し替えると
  // connectTerminalWs/bindTerminalInput 等がこの identity をクロージャで
  // 握っているため、ソケット/入力バインドの実行時状態が新旧オブジェクトに
  // 分裂して壊れる（例: 入力が閉じた古いソケットへ送られ続ける）。
  // tab の identity は変えず、フィールド変更を知りたい側がこの版数を
  // 明示的に依存に含めることで再計算のトリガーにする。
  const tabWorkspaceVersion = ref(0);
  // closeTab がローカル除去済み・サーバー削除リクエスト未完了の sessionId。
  // syncSessionsFromServer のポーリングがこの間隙でタブを復活させるのを防ぐ。
  const pendingCloseSessionIds = ref(/** @type {Set<string>} */ (new Set()));
  // switchTab(tabId, { focus: false }) の直後、TerminalPane の isActive watcher が
  // 無条件で term.focus() してしまうのを一度だけ抑止するための one-shot フラグ。
  const suppressNextFocus = ref(false);

  function markPendingClose(sessionId) {
    if (!sessionId) return;
    pendingCloseSessionIds.value.add(sessionId);
  }

  function clearPendingClose(sessionId) {
    if (!sessionId) return;
    pendingCloseSessionIds.value.delete(sessionId);
  }
  // sessionId → エージェント状態（backendはblocked/working/idleのみを送る）。
  // status stream WS が更新する。
  const agentStates = reactive(/** @type {Record<string, string>} */ ({}));
  // sessionId → true。working から idle への遷移（=作業完了）を検知した
  // セッション。idle自体はバッジ非表示にするため、タブを見る（switchTab）
  // までは「done」として表示し続けるための別レイヤー。
  const doneSessions = reactive(/** @type {Record<string, boolean>} */ ({}));

  /**
   * status stream WS から届いたエージェント状態をマージする。
   * working→idle の遷移を「done」として doneSessions に記録し、
   * idle以外（working/blocked）が届いたら doneSessions はクリアする
   * （新しい作業の開始、またはblockedでの入力待ちがdoneより優先されるため）。
   * @param {{ session_id: string, state: string }[]} states
   */
  function applyAgentStates(states) {
    if (!Array.isArray(states)) return;
    for (const entry of states) {
      if (entry && typeof entry.session_id === "string" && typeof entry.state === "string") {
        const sessionId = entry.session_id;
        if (entry.state === "idle") {
          if (agentStates[sessionId] === "working") doneSessions[sessionId] = true;
        } else {
          delete doneSessions[sessionId];
        }
        agentStates[sessionId] = entry.state;
      }
    }
  }

  function setTabFlag(tabId, key, value) {
    if (!tabFlags[tabId]) tabFlags[tabId] = {};
    tabFlags[tabId][key] = value;
  }

  function clearAgentState(sessionId) {
    if (!sessionId) return;
    delete agentStates[sessionId];
    delete doneSessions[sessionId];
  }

  function clearDoneState(sessionId) {
    if (sessionId) delete doneSessions[sessionId];
  }

  // sessionId → notify_phrase 検知フラグ。タブが選択されたら見た扱いでクリアする。
  const phraseNotifySessions = reactive(/** @type {Record<string, boolean>} */ ({}));

  function markPhraseNotify(sessionId) {
    if (sessionId) phraseNotifySessions[sessionId] = true;
  }

  function clearPhraseNotify(sessionId) {
    if (sessionId) delete phraseNotifySessions[sessionId];
  }

  function clearTabFlags(tabId) {
    delete tabFlags[tabId];
  }

  function saveTerminalSettings() {
    safeJsonSave(TERMINAL_SETTINGS_KEY, terminalSettings.value);
  }

  function setTerminalSetting(key, value) {
    if (!(key in DEFAULT_TERMINAL_SETTINGS)) return null;
    const next = sanitizeTerminalSetting(key, value);
    terminalSettings.value[key] = next;
    saveTerminalSettings();
    return next;
  }

  function resetTerminalSettings() {
    terminalSettings.value = { ...DEFAULT_TERMINAL_SETTINGS };
    saveTerminalSettings();
    return terminalSettings.value;
  }

  // 同一 session_id のタブ追加は必ずここで弾く。呼び出し側（useSessionSync の
  // ポーリング/WS通知、useDispatchConfirm の focusSession 等）はそれぞれ
  // 独立した非同期処理で「既存タブが無いか」を確認してから addTerminalTab を
  // 呼ぶが、確認から呼び出しまでの await の間に別経路が同じセッションのタブを
  // 追加してしまうレースがあり、二重タブが生成されうる。store 側の唯一の
  // 追加窓口でチェックすることで、呼び出し側の確認タイミングに関わらず防ぐ。
  function addTerminalTab({ wsUrl, workspace, wsIcon, wsIconColor, icon, iconColor, jobName, jobLabel, restored }) {
    const sessionId = wsUrl.replace(/.*\/terminal\/ws\//, "").replace(/\?.*/, "");
    const existing = openTabs.value.find((t) => t.sessionId === sessionId);
    if (existing) return existing;

    const opts = getTerminalRuntimeOptions();
    const term = new Terminal({ ...opts, allowProposedApi: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((e, uri) => {
      if (isTouchInput() && !_longPressActive) return;
      // WebLinksAddon はアプリ側が明示的に改行した URL（xterm の自動折返しではない）を
      // 連結できず途中で切れることがあるため、クリック座標から改めて全体を再計算する。
      const fullUri = findUrlInBuffer(term, e.clientX, e.clientY) || uri;
      bridgeEmit("terminal:url", { uri: fullUri });
    }, {
      // デフォルトの内蔵regexは http(s):// のみで www. 始まりのURLを認識せず、
      // タップしても反応しない（findUrlInBuffer側のTERMINAL_URL_REGEXと合わせて
      // 拾えるURL形式を揃える）。WebLinksAddon側でgフラグを重複付与するため、
      // sourceのみ渡してフラグ無しにする。
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

  function removeTab(tabId) {
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
  function pickActiveAfter(idx) {
    const tabs = openTabs.value;
    const next = tabs.find((_, i) => i >= idx) || tabs[tabs.length - 1];
    activeTabId.value = next ? next.id : null;
  }

  function switchTab(tabId, { focus = true } = {}) {
    activeTabId.value = tabId;
    if (!focus) suppressNextFocus.value = true;
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (tab) {
      localStorage.setItem(LS_KEY_ACTIVE_SESSION, tab.sessionId);
      clearPhraseNotify(tab.sessionId);
      clearDoneState(tab.sessionId);
    }
  }

  function detachTab(tabId) {
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
   * @param {number} tabId
   * @param {string | null} workspaceName
   * @param {{ icon?: string, iconColor?: string } | null} [iconInfo] 紐付け先
   *   ワークスペースのアイコン。渡すとタブバー等のアイコン（tab.wsIcon）も
   *   即座に切り替わる（未指定時はワークスペース名のみ更新。null許容だが
   *   その場合アイコンは変えない＝呼び出し側がアイコン解決できない場合用）。
   */
  function setTabWorkspace(tabId, workspaceName, iconInfo = null) {
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

  function moveTab(fromIndex, toIndex) {
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

  function getTerminalRuntimeOptions() {
    return {
      cursorBlink: terminalSettings.value.cursorBlink,
      cursorStyle: terminalSettings.value.cursorStyle,
      fontSize: terminalSettings.value.fontSize,
      fontFamily: '"Hack Nerd Font", monospace',
      scrollback: terminalSettings.value.scrollback,
      scrollOnOutput: terminalSettings.value.scrollOnOutput,
    };
  }

  return {
    openTabs,
    activeTabId,
    hasRestoredTabsFromStorage,
    restoreSessionsLoading,
    restoreSessionsError,
    terminalSettings,
    tabFlags,
    pendingCloseSessionIds,
    suppressNextFocus,
    markPendingClose,
    clearPendingClose,
    agentStates,
    applyAgentStates,
    clearAgentState,
    doneSessions,
    clearDoneState,
    phraseNotifySessions,
    markPhraseNotify,
    clearPhraseNotify,
    setTabFlag,
    clearTabFlags,
    TERMINAL_SETTINGS_KEY,
    TERMINAL_SETTINGS_META,
    DEFAULT_TERMINAL_SETTINGS,
    saveTerminalSettings,
    setTerminalSetting,
    addTerminalTab,
    removeTab,
    switchTab,
    detachTab,
    moveTab,
    setTabWorkspace,
    tabWorkspaceVersion,
    loadTabOrder,
    resetTerminalSettings,
    sanitizeTerminalSetting,
    sanitizeTerminalSettings,
  };
});
