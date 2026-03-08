<template>
  <ModalBase ref="baseModal" :title="currentTitle" :back="hasBack" :swipe-close="true" @back="goBack">
    <div v-show="currentView === 'menu'" class="settings-menu-content">
      <div class="settings-menu">
        <button type="button" class="settings-menu-item" @click="openView('workspace', 'ワークスペース')">
          <span class="mdi mdi-folder-multiple"></span> ワークスペース
        </button>
        <button type="button" class="settings-menu-item" @click="openView('wsAdd', 'ワークスペース追加')">
          <span class="mdi mdi-plus-circle-outline"></span> ワークスペース追加
        </button>
        <button type="button" class="settings-menu-item" @click="openView('wsConfig', 'ワークスペース設定')">
          <span class="mdi mdi-cog-outline"></span> ワークスペース設定
        </button>
        <button type="button" class="settings-menu-item" @click="openView('tab', 'タブ')">
          <span class="mdi mdi-tab"></span> タブ
        </button>
        <button type="button" class="settings-menu-item" @click="openView('terminal', 'ターミナル')">
          <span class="mdi mdi-format-font-size-increase"></span> ターミナル
        </button>
        <button type="button" class="settings-menu-item" @click="openView('editor', 'エディタ')">
          <span class="mdi mdi-application-edit-outline"></span> エディタ
        </button>
        <button type="button" class="settings-menu-item" @click="openView('config', '設定ファイル')">
          <span class="mdi mdi-file-cog"></span> 設定ファイル
        </button>
        <button type="button" class="settings-menu-item" @click="openView('server', 'サーバー情報')">
          <span class="mdi mdi-information-outline"></span> サーバー情報
        </button>
      </div>
    </div>
    <WorkspaceOpen v-if="currentView === 'workspace'" ref="workspaceView" />
    <SettingsWsAdd v-if="currentView === 'wsAdd'" />
    <SettingsWsConfig v-if="currentView === 'wsConfig'" ref="wsConfigView" @update:title="onWsConfigTitle" />
    <SettingsTab v-if="currentView === 'tab'" />
    <SettingsTerminal v-if="currentView === 'terminal'" />
    <SettingsEditor v-if="currentView === 'editor'" />
    <SettingsServerInfo v-if="currentView === 'server'" ref="serverInfo" />
    <SettingsConfigFile v-if="currentView === 'config'" />
  </ModalBase>
</template>

<script setup>
import { ref, computed, nextTick } from "vue";
import ModalBase from "./ModalBase.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import SettingsWsAdd from "./SettingsWsAdd.vue";
import SettingsWsConfig from "./SettingsWsConfig.vue";
import SettingsTab from "./SettingsTab.vue";
import SettingsTerminal from "./SettingsTerminal.vue";
import SettingsEditor from "./SettingsEditor.vue";
import SettingsServerInfo from "./SettingsServerInfo.vue";
import SettingsConfigFile from "./SettingsConfigFile.vue";

const baseModal = ref(null);
const serverInfo = ref(null);
const workspaceView = ref(null);
const wsConfigView = ref(null);
const wsConfigInDetail = ref(false);
const currentView = ref("menu");
const currentTitle = ref("設定");
const hasBack = computed(() => currentView.value !== "menu");

function openView(view, title) {
  currentView.value = view;
  currentTitle.value = title;
  if (view === "workspace") {
    nextTick(() => workspaceView.value?.load());
  }
}

function goBack() {
  if (currentView.value === "wsConfig" && wsConfigInDetail.value) {
    wsConfigView.value?.goBackToList();
    wsConfigInDetail.value = false;
    currentTitle.value = "ワークスペース設定";
    return;
  }
  currentView.value = "menu";
  currentTitle.value = "設定";
}

function onWsConfigTitle(title) {
  currentTitle.value = title;
  wsConfigInDetail.value = title !== "ワークスペース設定";
}

function open(view) {
  if (view) {
    const titles = { workspace: "ワークスペース", wsAdd: "ワークスペース追加", wsConfig: "ワークスペース設定", tab: "タブ", terminal: "ターミナル", editor: "エディタ", config: "設定ファイル", server: "サーバー情報" };
    openView(view, titles[view] || "設定");
  } else {
    currentView.value = "menu";
    currentTitle.value = "設定";
  }
  baseModal.value?.open();
}

function close() {
  baseModal.value?.close();
  currentView.value = "menu";
  currentTitle.value = "設定";
}

defineExpose({ open, close });
</script>
