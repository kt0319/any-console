<template>
  <LoginScreen v-if="showLogin" ref="loginScreen" @authenticated="onAuthenticated" />
  <template v-if="authenticated">
    <AppShell ref="appShell" />
    <SettingsModal ref="settingsModal" />
    <JobConfirmModal ref="jobConfirmModal" />
    <IconPicker ref="iconPicker" />
    <FileModal ref="fileModal" />
  </template>
  <AppToast ref="appToast" />
</template>

<script setup>
import { ref, onMounted } from "vue";
import LoginScreen from "./LoginScreen.vue";
import AppShell from "./AppShell.vue";
import SettingsModal from "./SettingsModal.vue";
import JobConfirmModal from "./JobConfirmModal.vue";
import IconPicker from "./IconPicker.vue";
import FileModal from "./FileModal.vue";
import AppToast from "./AppToast.vue";
import { on, emit } from "../app-bridge.js";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const layoutStore = useLayoutStore();

const loginScreen = ref(null);
const appShell = ref(null);
const settingsModal = ref(null);
const jobConfirmModal = ref(null);
const iconPicker = ref(null);
const fileModal = ref(null);
const appToast = ref(null);

const showLogin = ref(false);
const authenticated = ref(false);

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
      workspaceStore.allWorkspaces = data.workspaces || [];
      if (!workspaceStore.selectedWorkspace) {
        const first = workspaceStore.visibleWorkspaces[0];
        if (first) workspaceStore.selectedWorkspace = first.name;
      }
    }
  } catch (e) {
    console.error("initApp failed:", e);
  }
}

onMounted(async () => {
  if (layoutStore.isPwa) document.documentElement.classList.add("pwa");

  on("toast:show", ({ message, type }) => appToast.value?.show(message, type));
  on("settings:open", (detail) => settingsModal.value?.open(detail?.view));
  on("settings:close", () => settingsModal.value?.close());
  on("job:openConfirm", ({ name, job, workspace }) => jobConfirmModal.value?.open(name, job, workspace));
  on("job:closeConfirm", () => jobConfirmModal.value?.close());
  on("iconPicker:open", ({ callback, currentIcon, currentColor }) => iconPicker.value?.open(callback, currentIcon, currentColor));
  on("iconPicker:close", () => iconPicker.value?.close());
  on("git:openFileModal", (detail) => fileModal.value?.open(detail));
  on("git:closeFileModal", () => fileModal.value?.close());

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
