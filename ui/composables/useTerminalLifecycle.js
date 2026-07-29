import { nextTick, ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminal } from "./useTerminal.js";
import { useToast } from "./useToast.js";
import { usePrompt } from "./usePrompt.js";
import { EP_RUN, terminalSessionDetachedPath } from "../utils/endpoints.js";
import { TERMINAL_JOB_KEY } from "../utils/constants.js";
import { collectCommandVars } from "../utils/command-vars.js";

export function useTerminalLifecycle({ terminalBaseView }) {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();
  const layoutStore = useLayoutStore();
  const workspaceStore = useWorkspaceStore();
  const { disconnectTerminal, deleteSession, connectTerminalWs } = useTerminal();
  const toast = useToast();
  const { prompt } = usePrompt();

  const isLaunching = ref(false);

  // nextTick は DOM への反映までしか保証しないため、実際に1フレーム描画されるまで
  // 2 回の rAF で待つ（レイヤーを解除する前にタブが見えていることを確実にするため）。
  function waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function activateTerminalTab(tabId, { focus = true } = {}) {
    terminalStore.switchTab(tabId, { focus });

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
  }

  async function launchTerminal({ workspace, icon, iconColor, jobName, jobLabel, jobIcon, jobIconColor, initialCommand, detached }) {
    try {
      const commandVars = await collectCommandVars(initialCommand, prompt);
      if (commandVars === null) return; // プレースホルダー入力がキャンセルされた
      // タブがまだ存在しない間、現在のアクティブタブを操作できてしまわないよう
      // タブ作成完了までブロックする。
      isLaunching.value = true;
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
          // UIからの直接操作であることを明示する。他デバイスのタブバーにも
          // 表示されるようにするため（外部ツールからの/run直叩きと区別する）。
          interactive: true,
        },
      });
      if (!res || !res.ok) {
        const detail = res ? await res.text() : "no response";
        toast.error(`Terminal launch failed: ${detail}`);
        return;
      }
      const data = await res.json();
      if (detached) {
        // detached 起動: タブに追加せず、セッションを detached としてマークするだけ。
        // Tabs パネルの Detached tabs セクションに表示される。
        if (data.session_id) {
          auth.apiFetch(terminalSessionDetachedPath(data.session_id), {
            method: "PUT", body: { detached: true },
          }).catch(() => {});
        }
        const label = jobLabel || jobName || "Job";
        toast.show(`${label} started in background`, "success");
        return;
      }
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
      });
      activateTerminalTab(tab.id, { focus: false });
      if (workspace) workspaceStore.selectedWorkspace = workspace;
      await nextTick();
      terminalBaseView.value?.fitAllTerminals();
      activateTerminalTab(tab.id);
      await waitForNextPaint();
    } catch (e) {
      toast.error(`Terminal launch error: ${e.message}`);
    } finally {
      isLaunching.value = false;
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
    if (tabObj._reconnectTimer) clearTimeout(tabObj._reconnectTimer);
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
    if (sessionId) terminalStore.markPendingClose(sessionId);
    if (tabObj) disconnectTerminal(tabObj);
    terminalStore.removeTab(tabId);
    if (layoutStore.isSplitMode) {
      layoutStore.replaceTabWithEmpty(tabId);
    }
    await nextTick();
    if (tabObj?.term) tabObj.term.dispose();
    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } finally {
        terminalStore.clearPendingClose(sessionId);
      }
    }
  }

  return {
    activateTerminalTab,
    launchTerminal,
    refreshTab,
    closeTab,
    isLaunching,
  };
}
