import { nextTick } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminal } from "./useTerminal.js";
import { useToast } from "./useToast.js";
import { usePrompt } from "./usePrompt.js";
import { EP_RUN } from "../utils/endpoints.js";
import { TERMINAL_JOB_KEY } from "../utils/constants.js";
import { extractPlaceholders } from "../utils/placeholders.js";

export function useTerminalLifecycle({ terminalBaseView }) {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();
  const layoutStore = useLayoutStore();
  const workspaceStore = useWorkspaceStore();
  const { disconnectTerminal, deleteSession, connectTerminalWs } = useTerminal();
  const toast = useToast();
  const { prompt } = usePrompt();

  // コマンド内の {{name}} を起動時に入力させて値を集める。
  // キャンセルされたら null を返し、起動を中止する。
  async function collectCommandVars(command) {
    const names = extractPlaceholders(command);
    if (names.length === 0) return {};
    const vars = {};
    for (const name of names) {
      const value = await prompt({
        title: `Enter ${name}`,
        placeholder: name,
        confirmLabel: "Run",
      });
      if (value == null) return null;
      vars[name] = value;
    }
    return vars;
  }

  function focusTabTerminal(tabId) {
    const tab = terminalStore.openTabs.find((t) => t.id === tabId);
    if (!tab?.term) return;
    requestAnimationFrame(() => {
      try {
        tab.term.focus();
      } catch {}
    });
  }

  function activateTerminalTab(tabId, { focus = true } = {}) {
    terminalStore.switchTab(tabId);

    if (layoutStore.isSplitMode) {
      const existingPaneIndex = layoutStore.splitPaneTabIds.indexOf(tabId);
      if (existingPaneIndex >= 0) {
        layoutStore.activePaneIndex = existingPaneIndex;
      } else {
        const nextPaneTabIds = [...layoutStore.splitPaneTabIds];
        const targetPaneIndex = Math.max(0, Math.min(layoutStore.activePaneIndex || 0, nextPaneTabIds.length));
        if (nextPaneTabIds.length === 0) {
          nextPaneTabIds.push(tabId);
        } else if (targetPaneIndex < nextPaneTabIds.length) {
          nextPaneTabIds[targetPaneIndex] = tabId;
        } else {
          nextPaneTabIds.push(tabId);
        }
        layoutStore.splitPaneTabIds = nextPaneTabIds;
        layoutStore.activePaneIndex = nextPaneTabIds.indexOf(tabId);
      }
    }

    if (focus) focusTabTerminal(tabId);
  }

  function ensureKeyboardTargetTab() {
    if (terminalStore.openTabs.length === 0) return;
    const hasActive = terminalStore.openTabs.some((t) => t.id === terminalStore.activeTabId);
    if (hasActive) return;

    if (layoutStore.isSplitMode) {
      const ids = layoutStore.splitPaneTabIds || [];
      const paneIndex = layoutStore.activePaneIndex || 0;
      const isReal = (id) => id != null && !layoutStore.isEmptyPaneId(id);
      const targetId = isReal(ids[paneIndex]) ? ids[paneIndex] : ids.find(isReal);
      if (targetId) {
        terminalStore.switchTab(targetId);
        focusTabTerminal(targetId);
        return;
      }
    }

    const visibleTabs = terminalStore.openTabs.filter((t) => !t.hidden);
    const firstId = (visibleTabs[0] || terminalStore.openTabs[0]).id;
    terminalStore.switchTab(firstId);
    focusTabTerminal(firstId);
  }

  async function launchTerminal({ workspace, icon, iconColor, jobName, jobLabel, jobIcon, jobIconColor, initialCommand, hidden }) {
    try {
      const commandVars = await collectCommandVars(initialCommand);
      if (commandVars === null) return; // プレースホルダー入力がキャンセルされた
      const res = await auth.apiFetch(EP_RUN, {
        method: "POST",
        body: {
          job: TERMINAL_JOB_KEY,
          workspace: workspace || null,
          icon: icon || null,
          icon_color: iconColor || null,
          job_name: jobName || null,
          job_label: jobLabel || null,
          // コマンドはサーバ側で tmux に送り込む（ブラウザ未接続でも実行が走る）。
          // {{name}} は command_vars の値で shlex.quote 置換される。
          command: initialCommand || null,
          command_vars: commandVars,
        },
      });
      if (!res || !res.ok) {
        const detail = res ? await res.text() : "no response";
        toast.error(`Terminal launch failed: ${detail}`);
        return;
      }
      const data = await res.json();
      const tab = terminalStore.addTerminalTab({
        wsUrl: data.ws_url,
        workspace,
        wsIcon: icon,
        wsIconColor: iconColor,
        icon: jobName ? (jobIcon || "mdi-play") : "mdi-console",
        iconColor: jobIconColor,
        jobName,
        jobLabel,
        restored: false,
        hidden,
      });
      if (!hidden) activateTerminalTab(tab.id, { focus: false });
      if (workspace) workspaceStore.selectedWorkspace = workspace;
      await nextTick();
      terminalBaseView.value?.fitAllTerminals();
      if (!hidden) activateTerminalTab(tab.id);
    } catch (e) {
      toast.error(`Terminal launch error: ${e.message}`);
    }
  }

  function refreshTab(tab) {
    const tabObj = terminalStore.openTabs.find((t) => t.id === tab.id);
    if (!tabObj) return;
    // 現在の WebSocket を切ってから再接続。tmux session は維持する。
    if (tabObj.ws) {
      try { tabObj.ws.onclose = null; tabObj.ws.close(); } catch {}
      tabObj.ws = null;
    }
    clearTimeout(tabObj._reconnectTimer);
    tabObj._reconnectAttempts = 0;
    // xterm.js のバッファを完全にクリアして tmux capture-pane で screen を取り直す。
    // term.refresh() だけだと崩れたバッファをそのまま再描画してしまうため。
    try { tabObj.term?.reset(); } catch {}
    tabObj._needsHistoryRestore = true;
    tabObj._pendingRedraw = true;
    connectTerminalWs(tabObj, {
      focus: false,
      onOpen: () => {
        terminalBaseView.value?.fitAllTerminals({ force: true });
      },
    });
  }

  async function closeTab(tab) {
    const tabId = tab.id;
    const sessionId = tab.sessionId;
    const tabObj = terminalStore.openTabs.find((t) => t.id === tabId);
    if (tabObj) {
      disconnectTerminal(tabObj);
      if (tabObj.term) tabObj.term.dispose();
    }
    terminalStore.removeTab(tabId);
    if (layoutStore.isSplitMode) {
      layoutStore.replaceTabWithEmpty(tabId);
    }
    if (sessionId) {
      await deleteSession(sessionId);
    }
  }

  return {
    focusTabTerminal,
    activateTerminalTab,
    ensureKeyboardTargetTab,
    launchTerminal,
    refreshTab,
    closeTab,
  };
}
