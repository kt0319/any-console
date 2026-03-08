<template>
  <BaseModal ref="baseModal" :title="currentTitle" :swipe-close="true">
    <div v-show="currentView === 'menu'" class="settings-menu-content">
      <div class="settings-device-name">
        <label for="vue-device-name-input">端末名</label>
        <input
          id="vue-device-name-input"
          v-model="deviceName"
          type="text"
          placeholder="例: iPhone, iPad, PC"
          maxlength="30"
          autocomplete="off"
          @input="saveDeviceName"
        />
      </div>
      <div class="settings-menu">
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
    <SettingsTerminal v-if="currentView === 'terminal'" />
    <SettingsEditor v-if="currentView === 'editor'" />
    <SettingsServerInfo v-if="currentView === 'server'" ref="serverInfo" />
    <SettingsConfigFile v-if="currentView === 'config'" />
  </BaseModal>
</template>

<script setup>
import { ref } from "vue";
import BaseModal from "./BaseModal.vue";
import SettingsTerminal from "./SettingsTerminal.vue";
import SettingsEditor from "./SettingsEditor.vue";
import SettingsServerInfo from "./SettingsServerInfo.vue";
import SettingsConfigFile from "./SettingsConfigFile.vue";

const baseModal = ref(null);
const serverInfo = ref(null);
const currentView = ref("menu");
const currentTitle = ref("設定");
const deviceName = ref(localStorage.getItem("deviceName") || "");

function saveDeviceName() {
  const name = deviceName.value.trim();
  if (name) {
    localStorage.setItem("deviceName", name);
  } else {
    localStorage.removeItem("deviceName");
  }
}

function openView(view, title) {
  currentView.value = view;
  currentTitle.value = title;
}

function open(view) {
  if (view) {
    const titles = { terminal: "ターミナル", editor: "エディタ", config: "設定ファイル", server: "サーバー情報" };
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
