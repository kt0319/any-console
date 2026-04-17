<template>
  <ScreenLogin v-if="showLogin" @authenticated="onAuthenticated" />
  <template v-if="authenticated">
    <ScreenMain />
  </template>
  <AppToast ref="appToast" />
  <Transition name="offline-fade">
    <div v-if="isOffline" class="offline-overlay">
      <div class="offline-content">
        <div class="offline-spinner" aria-hidden="true"></div>
        <div class="offline-text">Connection lost</div>
        <div class="offline-sub">Waiting for network...</div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import ScreenLogin from "./ScreenLogin.vue";
import ScreenMain from "./ScreenMain.vue";
import AppToast from "./AppToast.vue";
import { on, emit } from "../app-bridge.js";
import { useAuthStore } from "../stores/auth.js";
import { useLayoutStore } from "../stores/layout.js";
import { EP_AUTH_CHECK, EP_RUN } from "../utils/endpoints.js";

const auth = useAuthStore();
const layoutStore = useLayoutStore();
const appToast = ref(null);

const showLogin = ref(false);
const authenticated = ref(false);
const isOffline = ref(false);

const PING_INTERVAL_MS = 3000;
const PING_TIMEOUT_MS = 2000;
const OFFLINE_THRESHOLD = 2;
let pingTimerId = null;
let consecutiveFailures = 0;

async function checkConnectivity() {
  if (!navigator.onLine) { consecutiveFailures = OFFLINE_THRESHOLD; isOffline.value = true; return; }
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
    await fetch(EP_AUTH_CHECK, {
      method: "HEAD",
      headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    consecutiveFailures = 0;
    isOffline.value = false;
  } catch {
    consecutiveFailures++;
    if (consecutiveFailures >= OFFLINE_THRESHOLD) {
      isOffline.value = true;
    }
  }
}

function startPing() {
  stopPing();
  pingTimerId = setInterval(checkConnectivity, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingTimerId != null) { clearInterval(pingTimerId); pingTimerId = null; }
}

async function execNonTerminalJob(jobName, workspace) {
  try {
    const res = await auth.apiFetch(EP_RUN, {
      method: "POST",
      body: { job: jobName, workspace },
    });
    if (!res) return;
    if (res.ok) {
      const data = await res.json();
      const msg = data.stdout || data.stderr || "Done";
      emit("toast:show", { message: msg, type: data.returncode === 0 ? "success" : "error" });
    } else {
      const detail = await res.text();
      emit("toast:show", { message: `Job failed: ${detail}`, type: "error" });
    }
  } catch (e) {
    emit("toast:show", { message: `Job error: ${e.message}`, type: "error" });
  }
}

async function onAuthenticated() {
  showLogin.value = false;
  authenticated.value = true;
}

function onOnline() { checkConnectivity(); }
function onOffline() { isOffline.value = true; }

onMounted(async () => {
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  startPing();

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
      auth.setServerInfo(result.hostname, result.version, result.clientName, result.vpn);
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

onBeforeUnmount(() => {
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  stopPing();
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

.git-ref {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  user-select: none;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  line-height: 1;
}

.git-ref .mdi {
  font-size: 12px;
}

.git-ref-branch {
  background: var(--accent);
  color: var(--bg-primary);
}

.git-ref-head {
  background: var(--success);
  color: var(--bg-primary);
}

.git-ref-remote {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.git-ref-tag {
  background: var(--warning);
  color: var(--bg-primary);
}

.commit-action-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.commit-action-menu button {
  padding: 5px 10px;
  font-size: 11px;
  min-height: 0;
}

.commit-action-item {
  padding: 4px 10px;
  font-size: 12px;
  min-height: 32px;
  min-width: auto;
  flex-shrink: 0;
  white-space: nowrap;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}

.commit-action-danger {
  color: var(--error);
  border-color: var(--error);
}

.diff-file-row-status {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 28px;
  text-align: center;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.diff-file-row-status.diff-status-mod {
  color: #8cb6ff;
  border-color: rgba(140, 182, 255, 0.45);
  background: rgba(140, 182, 255, 0.12);
}

.diff-file-row-status.diff-status-add {
  color: #7edb9a;
  border-color: rgba(126, 219, 154, 0.45);
  background: rgba(126, 219, 154, 0.12);
}

.diff-file-row-status.diff-status-del {
  color: #ff8e9a;
  border-color: rgba(255, 142, 154, 0.45);
  background: rgba(255, 142, 154, 0.12);
}

.diff-file-row-status.diff-status-ren {
  color: #ffd27a;
  border-color: rgba(255, 210, 122, 0.45);
  background: rgba(255, 210, 122, 0.12);
}

.diff-file-browser-list {
  flex: 1;
}

.diff-file-row {
  cursor: pointer;
}

.diff-file-row :deep(.file-browser-item-name) {
  font-size: 12px;
}

.diff-file-row-numstat {
  display: inline-flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 8px;
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  white-space: nowrap;
}

.form-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border: 2px solid var(--text-muted);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
}

.form-checkbox:checked {
  border-color: var(--accent);
  background: var(--accent);
}

.form-checkbox:checked::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid var(--bg-primary);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.form-check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-select-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 40px;
  font-size: 13px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.icon-select-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.icon-select-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

.ws-settings-section {
  padding: 8px 0;
}

.ws-settings-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}

.ws-settings-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
  min-width: 48px;
}

.clone-repo-loading,
.clone-repo-empty,
.clone-repo-error,
.job-config-error {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.clone-repo-error,
.job-config-error {
  color: var(--error);
}

.text-muted-center {
  color: var(--text-muted);
  padding: 16px;
  text-align: center;
}

.drag-handle {
  flex-shrink: 0;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 20px;
  cursor: grab;
  touch-action: none;
}

.offline-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 27, 38, 0.92);
}

.offline-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.offline-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

.offline-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.offline-sub {
  font-size: 13px;
  color: var(--text-muted);
}

.offline-fade-enter-active {
  transition: opacity 0.2s ease;
}

.offline-fade-leave-active {
  transition: opacity 0.3s ease;
}

.offline-fade-enter-from,
.offline-fade-leave-to {
  opacity: 0;
}
</style>
