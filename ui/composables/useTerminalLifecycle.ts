import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { Ref } from "vue";
import { useAuthStore } from "../stores/auth.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import type { TerminalTab } from "../stores/terminal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminal } from "./useTerminal.ts";
import { useToast } from "./useToast.ts";
import { usePrompt } from "./usePrompt.ts";
import { EP_RUN, terminalSessionDetachedPath, terminalSessionCwdPath } from "../utils/endpoints.ts";
import { TERMINAL_JOB_KEY, BARE_TERMINAL_CWD_POLL_INTERVAL_MS } from "../utils/constants.ts";
import { collectCommandVars } from "../utils/command-vars.ts";
import { rememberJobIcon } from "./useSessionSync.ts";
import { useApi } from "./useApi.ts";
import { basename } from "../utils/path.ts";

interface TerminalBaseViewRef {
  fitAllTerminals: (opts?: { force?: boolean }) => void;
}

interface LaunchTerminalOptions {
  workspace?: string | null;
  icon?: string | null;
  iconColor?: string | null;
  jobName?: string | null;
  jobLabel?: string | null;
  jobIcon?: string | null;
  jobIconColor?: string | null;
  initialCommand?: string | null;
  detached?: boolean;
}

export function useTerminalLifecycle({ terminalBaseView }: { terminalBaseView: Ref<TerminalBaseViewRef | null> }) {
  const auth = useAuthStore();
  const { apiGet } = useApi();
  const terminalStore = useTerminalStore();
  const layoutStore = useLayoutStore();
  const workspaceStore = useWorkspaceStore();
  const { disconnectTerminal, deleteSession, connectTerminalWs } = useTerminal();
  const toast = useToast();
  const { prompt } = usePrompt();

  const isLaunching = ref(false);

  // nextTick は DOM 反映までしか保証しないため、2 回の rAF で実描画を待つ。
  function waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function activateTerminalTab(tabId: number, { focus = true }: { focus?: boolean } = {}) {
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

  // ベアターミナルはタブ名が固定の"terminal"で見分けが付かないため、実cwdのディレクトリ名を反映する（失敗時は"terminal"のまま）。
  async function applyBareTerminalCwdLabel(tabId: number, sessionId: string) {
    const { ok, data } = await apiGet(terminalSessionCwdPath(sessionId));
    const dirName = ok ? basename(data?.cwd) : "";
    if (dirName) terminalStore.setTabLabel(tabId, dirName);
  }

  // cd への追従用。常時ポーリングのコストを避けるため、アクティブなベアターミナルの間だけ取得する。
  let bareTerminalCwdPollId: ReturnType<typeof setInterval> | null = null;

  function pollActiveBareTerminalCwd() {
    if (document.hidden) return;
    const tab = terminalStore.activeTab;
    if (!tab || tab.workspace || tab.jobName) return;
    applyBareTerminalCwdLabel(tab.id, tab.sessionId);
  }

  onMounted(() => {
    bareTerminalCwdPollId = setInterval(pollActiveBareTerminalCwd, BARE_TERMINAL_CWD_POLL_INTERVAL_MS);
  });

  onBeforeUnmount(() => {
    if (bareTerminalCwdPollId != null) {
      clearInterval(bareTerminalCwdPollId);
      bareTerminalCwdPollId = null;
    }
  });

  async function launchTerminal({ workspace, icon, iconColor, jobName, jobLabel, jobIcon, jobIconColor, initialCommand, detached }: LaunchTerminalOptions) {
    // 起動ボタン側はdisabled化していないためここで多重起動を防ぐ。collectCommandVarsのawait前に立て、タブ生成後は連続起動を阻害しないよう解除する。
    if (isLaunching.value) return;
    isLaunching.value = true;
    try {
      const commandVars = await collectCommandVars(initialCommand, prompt);
      if (commandVars === null) return; // プレースホルダー入力がキャンセルされた
      // セッションに永続化される（TMUX_ICON。他デバイスからも見える）アイコンはジョブ固有のものを優先する。
      const sessionIcon = jobName && jobIcon ? jobIcon : icon;
      const sessionIconColor = jobName && jobIcon ? jobIconColor : iconColor;
      const res = await auth.apiFetch(EP_RUN, {
        method: "POST",
        body: {
          job: TERMINAL_JOB_KEY,
          workspace: workspace || null,
          icon: sessionIcon || null,
          icon_color: sessionIconColor || null,
          job_name: jobName || null,
          job_label: jobLabel || null,
          // コマンドはサーバ側で tmux に送る（ブラウザ未接続でも実行される）。{{name}} は command_vars で shlex.quote 置換。
          command: initialCommand || null,
          command_vars: commandVars,
          // 外部ツールの /run 直叩きと区別し、他デバイスのタブバーにも表示させる
          interactive: true,
        },
      });
      if (!res || !res.ok) {
        const detail = res ? await res.text() : "no response";
        toast.error(`Terminal launch failed: ${detail}`);
        return;
      }
      const data = await res.json();
      // useSessionSync の再構築時に /jobs/workspaces が不完全でも、解決済みアイコンを使えるようにする
      if (jobName && jobIcon) rememberJobIcon(data.session_id, jobIcon, jobIconColor);
      if (detached) {
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
      // ワークスペース/ジョブ紐付きのラベルは既に意味を持つため、ベアターミナルのみ対象
      if (!workspace && !jobName && !jobLabel) applyBareTerminalCwdLabel(tab.id, data.session_id);
      isLaunching.value = false;
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

  function reconnectTab(tab: TerminalTab) {
    const tabObj = terminalStore.openTabs.find((t) => t.id === tab.id);
    if (!tabObj) return;
    if (tabObj.ws) {
      try { tabObj.ws.onclose = null; tabObj.ws.close(); } catch {}
      tabObj.ws = null;
    }
    if (tabObj._reconnectTimer) clearTimeout(tabObj._reconnectTimer);
    tabObj._reconnectAttempts = 0;
    // refresh() だけだと崩れたバッファをそのまま再描画するため、reset して capture-pane で取り直す
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

  async function terminateTab(tab: TerminalTab) {
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
    reconnectTab,
    terminateTab,
    isLaunching,
  };
}
