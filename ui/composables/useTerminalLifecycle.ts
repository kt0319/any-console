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

// TerminalBase.vue が defineExpose する形のうち、ここで使う部分。
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

  // nextTick は DOM への反映までしか保証しないため、実際に1フレーム描画されるまで
  // 2 回の rAF で待つ（レイヤーを解除する前にタブが見えていることを確実にするため）。
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

  // ワークスペース・ジョブいずれにも紐付かないベアターミナルはタブ名が常に
  // 固定文字列"terminal"になり、複数開くと見分けが付かない。起動直後の実cwd
  // （tmuxセッションの実際のカレントディレクトリ）からディレクトリ名を取得し、
  // タブ名に反映する（errorMessage未指定でベストエフォート。失敗時は
  // "terminal"のまま）。
  async function applyBareTerminalCwdLabel(tabId: number, sessionId: string) {
    const { ok, data } = await apiGet(terminalSessionCwdPath(sessionId));
    const dirName = ok ? basename(data?.cwd) : "";
    if (dirName) terminalStore.setTabLabel(tabId, dirName);
  }

  // cd で移動してもタブ名を追従させるため、アクティブタブがベアターミナルの間
  // だけ軽く定期取得する（バックグラウンドタブ・他タブは対象外にして、常に
  // 全タブ分ポーリングするコストを避ける）。setTabLabelは同じ値なら
  // 何もしないので、無駄な再描画は起きない。
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
    try {
      const commandVars = await collectCommandVars(initialCommand, prompt);
      if (commandVars === null) return; // プレースホルダー入力がキャンセルされた
      // タブがまだ存在しない間、現在のアクティブタブを操作できてしまわないよう
      // タブ作成完了までブロックする。
      isLaunching.value = true;
      // セッションに紐付ける（=TMUX_ICONとして永続化され、他デバイスやServer
      // Processes等サーバ側の情報からも見える）アイコンは、ジョブ固有のものが
      // 設定されていればそちらを優先する。タブ表示側（wsIcon/addTerminalTab）は
      // 従来通りワークスペースアイコンとジョブアイコンを両方使うため、ここでの
      // 変更はタブの見た目には影響しない。
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
      // 同期ポーリング(useSessionSync)がこのセッションを再構築する際、
      // /jobs/workspaces が一時的に不完全でもここで解決済みのアイコンを使えるようにする。
      if (jobName && jobIcon) rememberJobIcon(data.session_id, jobIcon, jobIconColor);
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
      // ベアターミナル（ワークスペース・ジョブどちらにも紐付かない）のみ対象。
      // ワークスペース/ジョブに紐付く場合はラベルが既に意味を持つため上書きしない。
      if (!workspace && !jobName && !jobLabel) applyBareTerminalCwdLabel(tab.id, data.session_id);
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

  function refreshTab(tab: TerminalTab) {
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

  async function closeTab(tab: TerminalTab) {
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
