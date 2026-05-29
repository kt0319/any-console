<template>
  <div v-if="fatalError" class="fatal-error-overlay">
    <span class="mdi mdi-alert-circle-outline fatal-error-icon"></span>
    <span class="fatal-error-msg">{{ fatalError }}</span>
    <button class="fatal-error-reload" @click="location.reload()">Reload</button>
  </div>
  <ScreenLogin v-if="showLogin" @authenticated="onAuthenticated" />
  <template v-if="authenticated">
    <ScreenMain />
  </template>
  <AppToast ref="appToast" />
  <ConfirmDialog />
  <PromptDialog />

  <!-- ターミナルURLアクションダイアログ -->
  <div v-if="terminalUrl" class="url-action-overlay" @click.self="terminalUrl = ''">
    <div class="url-action-dialog">
      <div class="url-action-url">{{ terminalUrl }}</div>
      <div class="url-action-buttons">
        <button class="url-action-btn" @click="doUrlOpen">
          <span class="mdi mdi-open-in-new"></span>Open
        </button>
        <button class="url-action-btn" @click="doUrlCopy">
          <span class="mdi" :class="urlCopied ? 'mdi-check' : 'mdi-content-copy'"></span>{{ urlCopied ? "Copied!" : "Copy URL" }}
        </button>
        <button class="url-action-btn url-action-btn-cancel" @click="terminalUrl = ''">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onErrorCaptured } from "vue";
import ScreenLogin from "./ScreenLogin.vue";
import ScreenMain from "./ScreenMain.vue";
import AppToast from "./AppToast.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import PromptDialog from "./PromptDialog.vue";
import { on, emit } from "../app-bridge.js";
import { useAuthStore } from "../stores/auth.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useAppJobBridge } from "../composables/useAppJobBridge.js";
import { useToast } from "../composables/useToast.js";

const auth = useAuthStore();
const toast = useToast();
const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();

const fatalError = ref(null);

onErrorCaptured((err) => {
  fatalError.value = err?.message || String(err);
  return false;
});

const APP_NAME = "any-console";
const activeTabLabel = computed(() => {
  if (!terminalStore.openTabs.some((t) => !t.hidden)) return "";
  const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
  if (!tab) return "";
  const ws = tab.workspace || "";
  const job = tab.jobLabel || tab.jobName || "";
  return [ws, job].filter(Boolean).join(" / ");
});
watch(activeTabLabel, (label) => {
  document.title = label ? `${APP_NAME} - ${label}` : APP_NAME;
}, { immediate: true });
const appToast = ref(null);
const { isOffline, startPing, stopPing, onOnline, onOffline } = useConnectivityMonitor();
const { bind: bindJobBridge } = useAppJobBridge();

const terminalUrl = ref("");
const urlCopied = ref(false);

function doUrlOpen() {
  if (terminalUrl.value) window.open(terminalUrl.value, "_blank", "noopener,noreferrer");
  terminalUrl.value = "";
}

async function doUrlCopy() {
  if (!terminalUrl.value) return;
  try {
    await navigator.clipboard.writeText(terminalUrl.value);
    urlCopied.value = true;
    setTimeout(() => { urlCopied.value = false; }, 1500);
  } catch {
    urlCopied.value = false;
  }
}

const showLogin = ref(false);
const authenticated = ref(false);

async function onAuthenticated() {
  showLogin.value = false;
  authenticated.value = true;
}

onMounted(async () => {
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  startPing();

  if (layoutStore.isPwa) document.documentElement.classList.add("pwa");

  on("toast:show", ({ message, type, duration, action }) => appToast.value?.show(message, type, duration, action));
  on("terminal:url", ({ uri }) => { terminalUrl.value = uri; urlCopied.value = false; });
  bindJobBridge();

  let result = await auth.checkToken();
  if (!result.ok && !result.auth) {
    const migrated = await auth.migrateLegacyToken();
    if (migrated) result = await auth.checkToken();
  }
  if (result.ok) {
    auth.markAuthenticated();
    auth.setServerInfo(result.hostname, result.version);
    await onAuthenticated();
  } else if (!result.auth) {
    showLogin.value = true;
  } else {
    toast.error(result.error);
    authenticated.value = true;
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

.fatal-error-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
}

.fatal-error-icon {
  font-size: 40px;
  color: var(--error);
}

.fatal-error-msg {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  max-width: 360px;
  word-break: break-word;
  font-family: ui-monospace, monospace;
}

.fatal-error-reload {
  font-size: 13px;
  padding: 7px 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
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
  color: var(--success);
}

.numstat-deleted {
  color: var(--error);
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
  display: block;
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

.commit-action-menu button,
.file-browser-action-menu button {
  padding: 5px 10px;
  font-size: 11px;
  min-height: 0;
}

.file-browser-action-delete {
  color: var(--error);
  border-color: var(--error);
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

.diff-file-row .file-browser-item-name {
  font-size: 13px;
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

/* ターミナルURLアクションダイアログ */
.url-action-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 12px;
  box-sizing: border-box;
}

.url-action-dialog {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.url-action-url {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}

.url-action-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.url-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  min-height: 0;
  width: 100%;
}

.url-action-btn .mdi {
  font-size: 16px;
}

.url-action-btn-cancel {
  color: var(--text-muted);
  margin-top: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .url-action-btn:hover {
    background: var(--bg-tertiary);
  }
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

</style>
