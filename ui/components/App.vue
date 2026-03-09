<template>
  <ScreenLogin v-if="showLogin" @authenticated="onAuthenticated" />
  <template v-if="authenticated">
    <ScreenMain />
  </template>
  <AppToast ref="appToast" />
</template>

<script setup>
import { ref, onMounted } from "vue";
import ScreenLogin from "./ScreenLogin.vue";
import ScreenMain from "./ScreenMain.vue";
import AppToast from "./AppToast.vue";
import { on, emit } from "../app-bridge.js";
import { useAuthStore } from "../stores/auth.js";
import { useLayoutStore } from "../stores/layout.js";

const auth = useAuthStore();
const layoutStore = useLayoutStore();
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
    } else if (!result.auth) {
      auth.token = "";
      auth.clearToken();
      showLogin.value = true;
    } else {
      emit("toast:show", { message: result.error, type: "error" });
      authenticated.value = true;
    }
  } else {
    showLogin.value = true;
  }
});
</script>
