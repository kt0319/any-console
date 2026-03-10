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

<style>
:root {
  --app-dvh: 100vh;
  --bg-primary: #1a1b26;
  --bg-secondary: #24283b;
  --bg-tertiary: #2f3347;
  --text-primary: #e0e4fc;
  --text-secondary: #b4bcde;
  --text-muted: #6e7599;
  --accent: #82aaff;
  --success: #7a9f6a;
  --error: #ff5572;
  --warning: #ffcb6b;
  --border: #3b4261;
  --radius: 8px;
  --accent-bg-20: rgba(130, 170, 255, 0.2);
  --white-30: rgba(255, 255, 255, 0.3);
  --success-bg-20: rgba(195, 232, 141, 0.2);
  --error-bg-20: rgba(255, 85, 114, 0.2);
  --warning-bg-20: rgba(255, 203, 107, 0.2);
  --overlay-bg: rgba(0, 0, 0, 0.35);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  touch-action: manipulation;
}

body {
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  height: var(--app-dvh);
  overflow: hidden;
}

.picker-ws-mini-btn.running::after,
.commit-action-danger.running::after {
  content: "";
  position: absolute;
  width: var(--spinner-size, 12px);
  height: var(--spinner-size, 12px);
  border: 2px solid rgba(130, 170, 255, 0.3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.commit-action-danger.running::after {
  border-color: rgba(255, 85, 114, 0.3);
  border-top-color: var(--error);
  inset: 0;
  margin: auto;
}

.stat-files {
  color: var(--warning);
}

.stat-add {
  color: var(--success);
}

.stat-del {
  color: var(--error);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

#app {
  position: fixed;
  inset: 0;
}

.numstat-added {
  color: #4caf50;
}

.numstat-deleted {
  color: #f44336;
}

.numstat-neutral {
  color: #ffffff;
}

.long-press-surface {
  position: relative;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

.long-press-surface::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--accent-bg-20);
  opacity: 0;
  pointer-events: none;
}

.long-press-surface.long-pressing::after {
  opacity: 1;
  transition: opacity 0.15s ease-out;
}

.long-press-surface.long-pressed::after {
  opacity: 1;
  transition: none;
}

button {
  font-family: inherit;
  font-size: 13px;
  padding: 7px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  min-height: 36px;
  min-width: 36px;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
  font-weight: 600;
  width: 100%;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form-input {
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
}

.form-input:focus {
  outline: none;
  border-color: var(--accent);
}

.diff-num-plus {
  color: var(--success);
}

.diff-num-del {
  color: var(--error);
}

.favicon-icon {
  display: inline-block;
  vertical-align: middle;
  border-radius: 2px;
}

.pwa, .pwa body {
  background: var(--bg-secondary);
}

#config-file-body,
.split-tab-settings-body:has(.config-file-code) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.split-tab-content:has(.config-file-code) {
  flex: 1;
}
</style>
