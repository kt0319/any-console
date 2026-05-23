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

      <div class="settings-menu-section-label">Customize</div>
      <button type="button" class="settings-menu-item" @click="pushView('TabConfig')">
        <span class="mdi mdi-tab"></span> Tabs
      </button>
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

      <div class="settings-menu-section-label">System</div>
      <button type="button" class="settings-menu-item" @click="pushView('AuthConfig')">
        <span class="mdi mdi-shield-lock-outline"></span> Auth
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ConfigFile')">
        <span class="mdi mdi-file-cog"></span> Config File
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ServerInfo')">
        <span class="mdi mdi-information-outline"></span> System Info
      </button>
    </div>
  </div>
</template>

<script setup>
import { inject } from "vue";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Settings";
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
  display: block;
  width: 100%;
  padding: 10px 14px;
  text-align: left;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
}
</style>
