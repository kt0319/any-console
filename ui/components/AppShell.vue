<template>
  <div class="main-panel" :class="{ 'panel-bottom': isPanelBottom }">
    <TabBar v-show="!isTextInputVisible" ref="tabBar" :tabs="openTabs" :orphans="orphanSessions" />
    <WorkspaceStatusBar v-show="!isTextInputVisible" />
    <TerminalBase ref="terminalSplit">
      <KeyboardBase v-if="isPanelBottom" v-show="!isTextInputVisible" ref="quickKeyboardBar" />
      <KeyboardInput
        v-if="isPanelBottom"
        ref="keyboardInputBar"
        @visibility="onKeyboardInputVisibility"
      />
    </TerminalBase>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import WorkspaceStatusBar from "./WorkspaceStatusBar.vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import KeyboardBase from "./KeyboardBase.vue";
import KeyboardInput from "./KeyboardInput.vue";
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

const tabBar = ref(null);
const terminalSplit = ref(null);
const quickKeyboardBar = ref(null);
const keyboardInputBar = ref(null);
const isTextInputVisible = ref(false);

const isPanelBottom = computed(() => layoutStore.isPanelBottom);

let resizeObserver = null;
let resizeDebounceTimer = null;

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
    keyboardInputBar.value?.show?.();
  });

  on("keyboard:deactivate", () => {
    keyboardInputBar.value?.hide?.();
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

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

function onKeyboardInputVisibility(visible) {
  isTextInputVisible.value = !!visible;
}

defineExpose({
  tabBar,
  terminalSplit,
  quickKeyboardBar,
  keyboardInputBar,
});
</script>
