<template>
  <div v-if="booting || showEmptyState" class="output-container screen-main-empty">
    <ScreenEmpty :booting="booting" :boot-message="bootMessage" @openWorkspace="openWorkspaceModal" />
  </div>
  <div v-else class="main-panel" :class="{ 'panel-bottom': isPanelBottom }">
    <TabBar v-show="!isTextInputVisible" ref="tabBar" :tabs="openTabs" :orphans="orphanSessions" />
    <WorkspaceStatusBar v-show="!isTextInputVisible" />
    <TerminalBase ref="terminalSplit" />
    <KeyboardBase
      ref="keyboardBase"
      :is-panel-bottom="isPanelBottom"
      @visibility="onKeyboardInputVisibility"
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
import KeyboardBase from "./KeyboardBase.vue";
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

async function initApp() {
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
    bootMessage.value = "ワークスペース状態を読み込み中...";
    await workspaceStore.fetchStatuses(auth);
  } catch (e) {
    console.error("initApp failed:", e);
  }

  bootMessage.value = "セッションを読み込み中...";
  await restoreExistingSessions();
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

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      bootMessage.value = `セッションを復元中... (${i + 1}/${sessions.length})`;
      const ws = workspaceStore.allWorkspaces.find((w) => w.name === s.workspace);
      terminalStore.addTerminalTab({
        wsUrl: s.ws_url,
        workspace: s.workspace,
        wsIcon: ws?.icon || s.icon || "mdi-console",
        wsIconColor: ws?.icon_color || s.icon_color,
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

async function loadSnippets() {
  if (inputStore.isSnippetsLoaded) return;
  try {
    const res = await auth.apiFetch("/snippets");
    if (!res || !res.ok) return;
    const data = await res.json();
    inputStore.snippetsCache = data.snippets || [];
    inputStore.isSnippetsLoaded = true;
  } catch {}
}

async function saveSnippets() {
  try {
    await auth.apiFetch("/snippets", {
      method: "PUT",
      body: { snippets: inputStore.snippetsCache },
    });
  } catch {}
}

const openTabs = computed(() => terminalStore.openTabs);
const orphanSessions = computed(() => terminalStore.orphanSessions);
const showEmptyState = computed(() => openTabs.value.length === 0 && !layoutStore.isSplitMode);

const tabBar = ref(null);
const terminalSplit = ref(null);
const keyboardBase = ref(null);
const isTextInputVisible = ref(false);

const isPanelBottom = computed(() => layoutStore.isPanelBottom);

let resizeObserver = null;
let resizeDebounceTimer = null;

function openWorkspaceModal() {
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
    terminalSplit.value?.fitAllTerminals();
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
  if (sessionId) {
    await deleteSession(sessionId);
  }
}

onMounted(() => {
  on("layout:fitAll", (detail) => {
    connectDeferredTabs();
    terminalSplit.value?.fitAllTerminals(detail);
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

  on("snippet:add", async ({ command }) => {
    const label = command.length > 40 ? command.slice(0, 40) : command;
    inputStore.snippetsCache.push({ label, command });
    await saveSnippets();
  });

  on("snippet:delete", async ({ index }) => {
    if (index >= 0 && index < inputStore.snippetsCache.length) {
      inputStore.snippetsCache.splice(index, 1);
      await saveSnippets();
    }
  });

  loadSnippets();

  on("keyboard:activate", () => {
    ensureKeyboardTargetTab();
    keyboardBase.value?.showInput?.();
  });

  on("keyboard:deactivate", () => {
    keyboardBase.value?.hideInput?.();
  });

  initViewport(() => {
    terminalSplit.value?.fitAllTerminals();
  });

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        resizeDebounceTimer = null;
        terminalSplit.value?.fitAllTerminals();
      }, 50);
    });
    const main = document.querySelector(".main-panel");
    if (main) resizeObserver.observe(main);
  }
});

onMounted(async () => {
  booting.value = true;
  bootMessage.value = "初期化中...";
  try {
    await initApp();
  } finally {
    booting.value = false;
    bootMessage.value = "読み込み中...";
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

function onKeyboardInputVisibility(visible) {
  isTextInputVisible.value = !!visible;
}

defineExpose({
  tabBar,
  terminalSplit,
  keyboardBase,
});
</script>

<style scoped>
.screen-main-empty {
  min-height: 100dvh;
}
</style>
