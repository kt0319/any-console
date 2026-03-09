<template>
  <LoginScreen v-if="showLogin" ref="loginScreen" @authenticated="onAuthenticated" />
  <template v-if="authenticated">
    <AppShell ref="appShell" />
    <Modal />
  </template>
  <AppToast ref="appToast" />
</template>

<script setup>
import { ref, onMounted } from "vue";
import LoginScreen from "./LoginScreen.vue";
import AppShell from "./AppShell.vue";
import Modal from "./Modal.vue";
import AppToast from "./AppToast.vue";
import { on, emit } from "../app-bridge.js";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();

const loginScreen = ref(null);
const appShell = ref(null);
const appToast = ref(null);

const showLogin = ref(false);
const authenticated = ref(false);

async function execNonTerminalJob(jobName, workspace) {
  try {
    const res = await auth.apiFetch("/run", {
      method: "POST",
      body: { job: jobName, workspace },
    });
    if (!res) return;
    if (res.ok) {
      const data = await res.json();
      const msg = data.stdout || data.stderr || "完了";
      emit("toast:show", { message: msg, type: data.returncode === 0 ? "success" : "error" });
    } else {
      const detail = await res.text();
      emit("toast:show", { message: `ジョブ失敗: ${detail}`, type: "error" });
    }
  } catch (e) {
    emit("toast:show", { message: `ジョブエラー: ${e.message}`, type: "error" });
  }
}

async function onAuthenticated() {
  showLogin.value = false;
  authenticated.value = true;
  await initApp();
}

async function initApp() {
  try {
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
    console.error("initApp failed:", e);
  }

  await restoreExistingSessions();
}

async function restoreExistingSessions() {
  if (terminalStore.hasRestoredTabsFromStorage) return;
  terminalStore.hasRestoredTabsFromStorage = true;
  try {
    const res = await auth.apiFetch("/terminal/sessions");
    if (!res || !res.ok) return;
    const sessions = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) return;

    for (const s of sessions) {
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
    setTimeout(() => emit("layout:fitAll"), 100);
    setTimeout(() => emit("layout:fitAll"), 500);
  } catch (e) {
    console.error("restoreExistingSessions failed:", e);
  }
}

onMounted(async () => {
  if (layoutStore.isPwa) document.documentElement.classList.add("pwa");

  on("toast:show", ({ message, type }) => appToast.value?.show(message, type));
  on("job:run", ({ jobName, job, workspace }) => {
    if (job?.terminal === false) {
      execNonTerminalJob(jobName, workspace);
      return;
    }
    emit("terminal:launch", {
      workspace,
      icon: job?.wsIcon,
      iconColor: job?.wsIconColor,
      jobName,
      jobLabel: job?.label,
      jobIcon: job?.icon,
      jobIconColor: job?.icon_color,
      initialCommand: job?.command,
    });
  });
  on("job:exec", ({ jobName, job, workspace }) => {
    execNonTerminalJob(jobName, workspace);
  });
  const savedToken = auth.loadToken();
  if (savedToken) {
    auth.token = savedToken;
    const result = await auth.checkToken();
    if (result.ok) {
      auth.setServerInfo(result.hostname, result.version, result.clientName);
      authenticated.value = true;
      await initApp();
    } else if (!result.auth) {
      auth.token = "";
      auth.clearToken();
      showLogin.value = true;
    } else {
      emit("toast:show", { message: result.error, type: "error" });
      authenticated.value = true;
      await initApp();
    }
  } else {
    showLogin.value = true;
  }
});
</script>
