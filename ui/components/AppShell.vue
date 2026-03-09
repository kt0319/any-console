<template>
  <div class="main-panel" :class="{ 'panel-bottom': panelBottom }">
    <StatusTabBar ref="tabBar" :tabs="openTabs" :orphans="orphanSessions" />
    <StatusGitBar />
    <TerminalBase ref="terminalSplit">
      <KeyboardInput v-if="panelBottom" ref="keyboardBar" />
    </TerminalBase>
    <KeyboardSnippet v-if="panelBottom" ref="snippetBar" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import StatusGitBar from "./StatusGitBar.vue";
import StatusTabBar from "./StatusTabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import KeyboardSnippet from "./KeyboardSnippet.vue";
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
const { disconnectTerminal, deleteSession } = useTerminal();
const { sendTextToTerminal } = useKeyboard();
const { initViewport } = useViewport();

async function loadSnippets() {
  if (inputStore.snippetsLoaded) return;
  try {
    const res = await auth.apiFetch("/snippets");
    if (!res || !res.ok) return;
    const data = await res.json();
    inputStore.snippetsCache = data.snippets || [];
    inputStore.snippetsLoaded = true;
  } catch {}
}

async function saveSnippets() {
  try {
    await auth.apiFetch("/snippets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snippets: inputStore.snippetsCache }),
    });
  } catch {}
}

const openTabs = computed(() => terminalStore.openTabs);
const orphanSessions = computed(() => terminalStore.orphanSessions);

const tabBar = ref(null);
const terminalSplit = ref(null);
const snippetBar = ref(null);
const keyboardBar = ref(null);

const panelBottom = computed(() => layoutStore.panelBottom);

let resizeObserver = null;
let resizeDebounceTimer = null;

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
  on("layout:fitAll", () => {
    terminalSplit.value?.fitAllTerminals();
  });

  on("layout:toggleSnippet", () => {
    snippetBar.value?.toggle();
  });

  on("tab:select", ({ tab }) => {
    terminalStore.switchTab(tab.id);
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
    if (keyboardBar.value && keyboardBar.value.mode === 0) {
      keyboardBar.value.cycleMode();
    }
  });

  on("keyboard:deactivate", () => {
    if (keyboardBar.value && keyboardBar.value.mode !== 0) {
      keyboardBar.value.cycleMode();
    }
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

defineExpose({
  tabBar,
  terminalSplit,
  snippetBar,
  keyboardBar,
});
</script>
