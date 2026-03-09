<template>
  <div class="settings-menu-content">
    <div class="settings-menu">
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'WorkspaceOpen' })">
        <span class="mdi mdi-folder-multiple"></span> ワークスペース
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'WorkspaceAdd' })">
        <span class="mdi mdi-plus-circle-outline"></span> ワークスペース追加
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'WorkspaceConfig' })">
        <span class="mdi mdi-cog-outline"></span> ワークスペース設定
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'TabConfig' })">
        <span class="mdi mdi-tab"></span> タブ
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'TerminalConfig' })">
        <span class="mdi mdi-format-font-size-increase"></span> ターミナル
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'EditorConfig' })">
        <span class="mdi mdi-application-edit-outline"></span> エディタ
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'ConfigFile' })">
        <span class="mdi mdi-file-cog"></span> 設定ファイル
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'ServerInfo' })">
        <span class="mdi mdi-information-outline"></span> サーバー情報
      </button>
    </div>
  </div>
</template>

<script setup>
import { inject } from "vue";

const emit = defineEmits(["select"]);
const modalTitle = inject("modalTitle");
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
