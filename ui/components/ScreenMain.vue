<template>
  <div v-if="booting || isEmptyScreenVisible" class="output-container screen-main-empty">
    <ScreenEmpty :booting="booting" :boot-message="bootMessage" @openWorkspace="openWorkspaceSelection" />
  </div>
  <div v-else class="main-panel" :class="{ 'panel-bottom': isPanelBottom }">
    <TabBar v-show="!isTextInputVisible" ref="tabBarView" :tabs="openTabs" :orphans="orphanSessions" />
    <WorkspaceStatusBar v-show="!isTextInputVisible" />
    <TerminalBase
      ref="terminalBaseView"
      :is-panel-bottom="isPanelBottom"
      @keyboard-input-visibility="updateKeyboardInputVisibility"
    />
  </div>
  <Modal />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import WorkspaceStatusBar from "./WorkspaceStatusBar.vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import ScreenEmpty from "./ScreenEmpty.vue";
import Modal from "./Modal.vue";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useInputStore } from "../stores/input.js";
import { useTerminal } from "../composables/useTerminal.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useViewport } from "../composables/useViewport.js";
import { on, emit } from "../app-bridge.js";

const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const inputStore = useInputStore();
const { disconnectTerminal, deleteSession, connectDeferredTabs } = useTerminal();
const { sendTextToTerminal } = useKeyboard();
const { initViewport } = useViewport();

const booting = ref(true);
const bootMessage = ref("読み込み中...");

async function initializeApp() {
  try {
    bootMessage.value = "ワークスペース一覧を読み込み中...";
    const res = await auth.apiFetch("/workspaces");
    if (res && res.ok) {
      const data = await res.json();
      workspaceStore.allWorkspaces = Array.isArray(data) ? data : (data.workspaces || []);
      if (!workspaceStore.selectedWorkspace) {
        const first = workspaceStore.visibleWorkspaces[0];
        if (first) workspaceStore.selectedWorkspace = first.name;
      }
    }
  } catch (e) {
    console.error("initializeApp failed:", e);
  }

  bootMessage.value = "セッションを読み込み中...";
  await Promise.all([
    workspaceStore.fetchStatuses(auth),
    restoreExistingSessions(),
  ]);
}

async function restoreExistingSessions() {
  if (terminalStore.hasRestoredTabsFromStorage) return;
  terminalStore.hasRestoredTabsFromStorage = true;
  terminalStore.restoreSessionsLoading = true;
  terminalStore.restoreSessionsError = "";
  const startAt = Date.now();
  const MIN_LOADING_MS = 400;
  try {
    const res = await auth.apiFetch("/terminal/sessions");
    if (!res || !res.ok) {
      let detail = "既存セッションの取得に失敗しました";
      try {
        const text = await res?.text?.();
        if (text) detail = text;
      } catch {}
      terminalStore.restoreSessionsError = detail;
      return;
    }
    const sessions = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) return;

    let allJobs = {};
    try {
      const jobsRes = await auth.apiFetch("/jobs/workspaces");
      if (jobsRes && jobsRes.ok) allJobs = await jobsRes.json();
    } catch {}

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      bootMessage.value = `セッションを復元中... (${i + 1}/${sessions.length})`;
      const ws = workspaceStore.allWorkspaces.find((w) => w.name === s.workspace);
      const jobDef = s.job_name && s.workspace ? allJobs[s.workspace]?.[s.job_name] : null;
      terminalStore.addTerminalTab({
        wsUrl: s.ws_url,
        workspace: s.workspace,
        wsIcon: ws?.icon || s.icon || "mdi-console",
        wsIconColor: ws?.icon_color || s.icon_color,
        icon: jobDef?.icon,
        iconColor: jobDef?.icon_color,
        jobName: s.job_name,
        jobLabel: s.job_label,
        restored: true,
      });
    }

    const first = terminalStore.openTabs[0];
    if (first) terminalStore.switchTab(first.id);
    setTimeout(() => emit("layout:fitAll", { force: true }), 500);
  } catch (e) {
    console.error("restoreExistingSessions failed:", e);
    terminalStore.restoreSessionsError = e?.message || "既存セッションの復元でエラーが発生しました";
  } finally {
    const elapsed = Date.now() - startAt;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS - elapsed));
    }
    terminalStore.restoreSessionsLoading = false;
  }
}

async function loadSnippetCache() {
  if (inputStore.isSnippetsLoaded) return;
  try {
    const res = await auth.apiFetch("/snippets");
    if (!res || !res.ok) return;
    const data = await res.json();
    inputStore.snippetsCache = data.snippets || [];
    inputStore.isSnippetsLoaded = true;
  } catch {}
}

async function persistSnippets() {
  try {
    await auth.apiFetch("/snippets", {
      method: "PUT",
      body: { snippets: inputStore.snippetsCache },
    });
  } catch {}
}

const openTabs = computed(() => terminalStore.openTabs);
const orphanSessions = computed(() => terminalStore.orphanSessions);
const isEmptyScreenVisible = computed(() => openTabs.value.length === 0 && !layoutStore.isSplitMode);

const tabBarView = ref(null);
const terminalBaseView = ref(null);
const isTextInputVisible = ref(false);

const isPanelBottom = computed(() => layoutStore.isPanelBottom);

let mainPanelResizeObserver = null;
let resizeFitTimerId = null;

function openWorkspaceSelection() {
  emit("workspace:openModal");
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

function ensureKeyboardTargetTab() {
  if (terminalStore.openTabs.length === 0) return;
  const hasActive = terminalStore.openTabs.some((t) => t.id === terminalStore.activeTabId);
  if (hasActive) return;

  if (layoutStore.isSplitMode) {
    const ids = layoutStore.splitPaneTabIds || [];
    const paneIndex = layoutStore.activePaneIndex || 0;
    const targetId = ids[paneIndex] || ids[0];
    if (targetId) {
      terminalStore.switchTab(targetId);
      focusTabTerminal(targetId);
      return;
    }
  }

  const firstId = terminalStore.openTabs[0].id;
  terminalStore.switchTab(firstId);
  focusTabTerminal(firstId);
}

async function launchTerminal({ workspace, icon, iconColor, jobName, jobLabel, jobIcon, jobIconColor, initialCommand }) {
  try {
    const res = await auth.apiFetch("/run", {
      method: "POST",
      body: {
        job: "terminal",
        workspace: workspace || null,
        icon: icon || null,
        icon_color: iconColor || null,
        job_name: jobName || null,
        job_label: jobLabel || null,
      },
    });
    if (!res || !res.ok) {
      const detail = res ? await res.text() : "no response";
      emit("toast:show", { message: `ターミナル起動失敗: ${detail}`, type: "error" });
      return;
    }
    const data = await res.json();
    const tab = terminalStore.addTerminalTab({
      wsUrl: data.ws_url,
      workspace,
      wsIcon: icon || "mdi-console",
      wsIconColor: iconColor,
      icon: jobIcon,
      iconColor: jobIconColor,
      jobName,
      jobLabel,
      initialCommand,
    });
    terminalStore.switchTab(tab.id);
    if (workspace) workspaceStore.selectedWorkspace = workspace;
    await nextTick();
    terminalBaseView.value?.fitAllTerminals();
  } catch (e) {
    emit("toast:show", { message: `ターミナル起動エラー: ${e.message}`, type: "error" });
  }
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
    layoutStore.splitPaneTabIds = layoutStore.splitPaneTabIds.filter((id) => id !== tabId);
    if (layoutStore.splitPaneTabIds.length < 2) {
      layoutStore.exitSplitMode();
    }
  }
  if (sessionId) {
    await deleteSession(sessionId);
  }
}

onMounted(() => {
  on("layout:fitAll", (detail) => {
    connectDeferredTabs();
    terminalBaseView.value?.fitAllTerminals(detail);
  });

  on("tab:select", ({ tab }) => {
    terminalStore.switchTab(tab.id);
    focusTabTerminal(tab.id);
    if (tab.workspace) {
      workspaceStore.selectedWorkspace = tab.workspace;
    }
  });

  on("tab:close", ({ tab }) => {
    closeTab(tab);
    const activeTab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
    workspaceStore.selectedWorkspace = activeTab?.workspace || null;
  });

  on("terminal:launch", (detail) => {
    launchTerminal(detail);
  });

  on("snippet:tap", ({ command }) => {
    sendTextToTerminal(command + "\n");
  });

  on("snippet:add", async ({ label, command }) => {
    const lbl = label || (command.length > 40 ? command.slice(0, 40) : command);
    inputStore.snippetsCache.push({ label: lbl, command });
    await persistSnippets();
  });

  on("snippet:delete", async ({ index }) => {
    if (index >= 0 && index < inputStore.snippetsCache.length) {
      inputStore.snippetsCache.splice(index, 1);
      await persistSnippets();
    }
  });

  loadSnippetCache();

  on("keyboard:activate", () => {
    ensureKeyboardTargetTab();
    terminalBaseView.value?.showKeyboardInput?.();
  });

  on("keyboard:deactivate", () => {
    terminalBaseView.value?.hideKeyboardInput?.();
  });

  initViewport(() => {
    terminalBaseView.value?.fitAllTerminals();
  });

  if (typeof ResizeObserver !== "undefined") {
    mainPanelResizeObserver = new ResizeObserver(() => {
      if (resizeFitTimerId) clearTimeout(resizeFitTimerId);
      resizeFitTimerId = setTimeout(() => {
        resizeFitTimerId = null;
        terminalBaseView.value?.fitAllTerminals();
      }, 50);
    });
    const main = document.querySelector(".main-panel");
    if (main) mainPanelResizeObserver.observe(main);
  }
});

onMounted(async () => {
  booting.value = true;
  bootMessage.value = "初期化中...";
  try {
    await initializeApp();
  } finally {
    booting.value = false;
    bootMessage.value = "読み込み中...";
  }
});

onBeforeUnmount(() => {
  mainPanelResizeObserver?.disconnect();
});

function updateKeyboardInputVisibility(visible) {
  isTextInputVisible.value = !!visible;
}

defineExpose({
  tabBar: tabBarView,
  terminalSplit: terminalBaseView,
});
</script>

<style scoped>
.screen-main-empty {
  height: var(--app-dvh);
  min-height: var(--app-dvh);
  align-items: stretch;
}

.main-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.main-panel.panel-bottom :deep(.output-container) {
  order: -1;
}

.main-panel.panel-bottom :deep(.tab-bar-row) {
  order: 2;
  position: relative;
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: 4px;
}

.main-panel.panel-bottom :deep(.tab-bar) {
  padding: 0 8px 4px;
}

.main-panel.panel-bottom :deep(.tab-btn) {
  border-radius: 0 0 6px 6px;
  padding: 6px 12px;
  gap: 2px;
  min-width: 80px;
  justify-content: center;
}

.main-panel.panel-bottom :deep(.workspace-status-bar) {
  order: 1;
  border-bottom: none;
  border-top: 1px solid var(--border);
}

.main-panel.keyboard-open :deep(.tab-bar-row),
.main-panel.keyboard-open :deep(.workspace-status-bar) {
  display: none !important;
}

:global(.pwa .main-panel.panel-bottom .tab-bar) {
  padding-bottom: 0;
}

:global(.pwa .main-panel.panel-bottom .tab-bar-row) {
  padding-bottom: 28px;
}
</style>
