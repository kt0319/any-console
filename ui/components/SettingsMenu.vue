<template>
  <div class="settings-menu-content">
    <div class="settings-menu">
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'workspace', title: 'ワークスペース' })">
        <span class="mdi mdi-folder-multiple"></span> ワークスペース
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'wsAdd', title: 'ワークスペース追加' })">
        <span class="mdi mdi-plus-circle-outline"></span> ワークスペース追加
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'wsConfig', title: 'ワークスペース設定' })">
        <span class="mdi mdi-cog-outline"></span> ワークスペース設定
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'tab', title: 'タブ' })">
        <span class="mdi mdi-tab"></span> タブ
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'terminal', title: 'ターミナル' })">
        <span class="mdi mdi-format-font-size-increase"></span> ターミナル
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'editor', title: 'エディタ' })">
        <span class="mdi mdi-application-edit-outline"></span> エディタ
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'config', title: '設定ファイル' })">
        <span class="mdi mdi-file-cog"></span> 設定ファイル
      </button>
      <button type="button" class="settings-menu-item" @click="emit('select', { view: 'server', title: 'サーバー情報' })">
        <span class="mdi mdi-information-outline"></span> サーバー情報
      </button>
    </div>
  </div>
</template>

<script setup>
const emit = defineEmits(["select"]);
</script>
