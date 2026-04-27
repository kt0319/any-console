<template>
  <div class="settings-menu-content">
    <div class="settings-menu">
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceOpen')">
        <span class="mdi mdi-folder-multiple"></span> Workspaces
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceAdd')">
        <span class="mdi mdi-plus-circle-outline"></span> Add Workspace
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceConfig')">
        <span class="mdi mdi-cog-outline"></span> Workspace Settings
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('GlobalJobConfig')">
        <span class="mdi mdi-briefcase-outline"></span> Global Jobs
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('TabConfig')">
        <span class="mdi mdi-tab"></span> Tabs
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('TerminalConfig')">
        <span class="mdi mdi-format-font-size-increase"></span> Terminal
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('EditorConfig')">
        <span class="mdi mdi-application-edit-outline"></span> Editor
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ConfigFile')">
        <span class="mdi mdi-file-cog"></span> Config File
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ServerInfo')">
        <span class="mdi mdi-information-outline"></span> Server Info
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ClientInfo')">
        <span class="mdi mdi-cellphone-information"></span> Client Info
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('SecurityConfig')">
        <span class="mdi mdi-shield-lock-outline"></span> Other Options
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
