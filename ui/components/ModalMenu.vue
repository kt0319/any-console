<template>
  <div class="modal-scroll-body">
    <div class="settings-menu">
      <div class="settings-category-head">
        <span class="settings-category-title">Workspaces</span>
      </div>
      <div class="settings-menu-group">
        <button type="button" class="settings-menu-item" @click="pushView('WorkspaceOpen')">
          <span class="mdi mdi-folder-multiple"></span> Workspaces
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('TabConfig')">
          <span class="mdi mdi-tab"></span> Tabs & Sessions
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('DispatchQueueConfig')">
          <span class="mdi mdi-tray-full"></span> Dispatches
          <span v-if="dispatchQueue.length > 0" class="settings-menu-count">{{ dispatchQueue.length }}</span>
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('PreviewPorts')">
          <span class="mdi mdi-open-in-app"></span> Port Preview
          <span v-if="previewPortCount > 0" class="settings-menu-version">{{ previewPortCount }} detected</span>
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('SendSnippet')">
          <span class="mdi mdi-bookmark-multiple"></span> Send Snippet
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('SendHistory')">
          <span class="mdi mdi-history"></span> Send History
        </button>
      </div>

      <div class="settings-category-head">
        <span class="settings-category-title">Customize</span>
      </div>
      <div class="settings-menu-group">
        <button type="button" class="settings-menu-item" @click="pushView('TerminalConfig')">
          <span class="mdi mdi-format-font-size-increase"></span> Terminal
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('EditorConfig')">
          <span class="mdi mdi-application-edit-outline"></span> Editor
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('DisplayConfig')">
          <span class="mdi mdi-monitor-eye"></span> Display
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('CircleKeyPadConfig')">
          <span class="mdi mdi-gesture-tap"></span> Circle Keypad
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('NotificationConfig')">
          <span class="mdi mdi-bell-outline"></span> Notifications
        </button>
      </div>

      <div class="settings-category-head">
        <span class="settings-category-title">System</span>
      </div>
      <div class="settings-menu-group">
        <button type="button" class="settings-menu-item" @click="pushView('AuthConfig')">
          <span class="mdi mdi-shield-lock-outline"></span> Auth
          <span v-if="authWarn" class="settings-menu-warn" data-tooltip="No token configured — anyone with network access can use this console">
            <span class="mdi mdi-alert"></span>
            <span class="settings-menu-warn-text">No token</span>
          </span>
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('ConfigFile')">
          <span class="mdi mdi-file-cog"></span> Config File
        </button>
        <button type="button" class="settings-menu-item" @click="pushView('ServerInfo')">
          <span class="mdi mdi-information-outline"></span> System Info
          <span v-if="appVersion" class="settings-menu-version">{{ appVersion }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { EP_SETTINGS_AUTH, EP_SYSTEM_INFO, EP_PREVIEW_PORTS } from "../utils/endpoints.js";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Settings";

const { apiGet } = useApi();
const authWarn = ref(false);
const appVersion = ref("");
const previewPortCount = ref(0);
const { queue: dispatchQueue } = useDispatchConfirm();

onMounted(async () => {
  const auth = await getWithRetry(apiGet, EP_SETTINGS_AUTH);
  if (auth.ok) authWarn.value = !auth.data?.auth_required;
  const info = await getWithRetry(apiGet, EP_SYSTEM_INFO);
  if (info.ok && info.data?.version) appVersion.value = info.data.version;
  // Settings を開くたび1回だけ取得する（常時ポーリングはしない。PreviewPorts.vue を
  // 開いている間だけの継続ポーリングとは別に、メニュー表示用の軽い一発取得）。
  const preview = await getWithRetry(apiGet, EP_PREVIEW_PORTS);
  if (preview.ok && Array.isArray(preview.data)) {
    previewPortCount.value = preview.data.filter((p) => !p.is_self).length;
  }
});
</script>

<style scoped>
.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-category-head {
  margin-top: 8px;
}

.settings-category-head:first-child {
  margin-top: 0;
}

.settings-menu-group {
  display: flex;
  flex-direction: column;
}

.settings-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  text-align: left;
  font-size: 14px;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.settings-menu-group .settings-menu-item:last-child {
  border-bottom: none;
}

@media (hover: hover) and (pointer: fine) {
  .settings-menu-item:hover {
    background: var(--bg-tertiary);
  }
}

.settings-menu-item:active {
  background: var(--bg-tertiary);
}

.settings-menu-warn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 170, 0, 0.15);
  color: var(--warning, #ffaa00);
  font-size: 12px;
  font-weight: 500;
}

.settings-menu-warn .mdi {
  font-size: 14px;
}

.settings-menu-count {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--bg-primary, #1a1b26);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.settings-menu-version {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
