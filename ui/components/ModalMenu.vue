<template>
  <div class="settings-menu-content">
    <div class="settings-menu">
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceOpen')">
        <span class="mdi mdi-folder-multiple"></span> ワークスペース
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceAdd')">
        <span class="mdi mdi-plus-circle-outline"></span> ワークスペース追加
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceConfig')">
        <span class="mdi mdi-cog-outline"></span> ワークスペース設定
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('TabConfig')">
        <span class="mdi mdi-tab"></span> タブ
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('TerminalConfig')">
        <span class="mdi mdi-format-font-size-increase"></span> ターミナル
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('EditorConfig')">
        <span class="mdi mdi-application-edit-outline"></span> エディタ
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ConfigFile')">
        <span class="mdi mdi-file-cog"></span> 設定ファイル
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ServerInfo')">
        <span class="mdi mdi-information-outline"></span> サーバー情報
      </button>
    </div>
  </div>
</template>

<script setup>
import { inject } from "vue";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "設定";
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
