<template>
  <div class="settings-menu-content">
    <div class="settings-menu">
      <div class="settings-menu-section-label">Workspaces</div>
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceOpen')">
        <span class="mdi mdi-folder-multiple"></span> Workspaces
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceAdd')">
        <span class="mdi mdi-folder-plus-outline"></span> Add Workspace
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('TabConfig')">
        <span class="mdi mdi-tab"></span> Tabs & Sessions
      </button>

      <div class="settings-menu-section-label">Customize</div>
      <button type="button" class="settings-menu-item" @click="pushView('TerminalConfig')">
        <span class="mdi mdi-format-font-size-increase"></span> Terminal
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('EditorConfig')">
        <span class="mdi mdi-application-edit-outline"></span> Editor
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('DisplayConfig')">
        <span class="mdi mdi-monitor-eye"></span> Display
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('SnippetConfig')">
        <span class="mdi mdi-bookmark-multiple"></span> Snippets
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('CircleKeyPadConfig')">
        <span class="mdi mdi-gesture-tap"></span> Circle Keypad
      </button>

      <div class="settings-menu-section-label">System</div>
      <button type="button" class="settings-menu-item" @click="pushView('PreviewPorts')">
        <span class="mdi mdi-open-in-app"></span> Port Preview
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('NotificationConfig')">
        <span class="mdi mdi-bell-outline"></span> Notifications
      </button>
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
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { EP_SETTINGS_AUTH, EP_SYSTEM_INFO } from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Settings";

const { apiGet } = useApi();
const authWarn = ref(false);
const appVersion = ref("");

onMounted(async () => {
  const auth = await getWithRetry(apiGet, EP_SETTINGS_AUTH);
  if (auth.ok) authWarn.value = !auth.data?.auth_required;
  const info = await getWithRetry(apiGet, EP_SYSTEM_INFO);
  if (info.ok && info.data?.version) appVersion.value = info.data.version;
});
</script>

<style scoped>
.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-menu-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 4px 4px 0;
}

.settings-menu-section-label:not(:first-child) {
  margin-top: 8px;
}

.settings-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  text-align: left;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
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

.settings-menu-version {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
