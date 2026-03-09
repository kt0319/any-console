<template>
  <div
    v-if="modal.visible.value"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @click.self="closeModal"
  >
    <div ref="modalEl" class="modal">
      <div class="modal-header">
        <h3
          class="modal-title"
          :class="{ 'modal-title-back': modalBack }"
          @click="modalBack ? onBack() : null"
        >
          <span v-if="modalBack" class="mdi mdi-arrow-left"></span>
          {{ modalTitle }}
        </h3>
        <button type="button" class="modal-close-btn" @click="closeModal">&times;</button>
      </div>
      <div class="modal-body">
        <SettingsMenu v-if="currentView === 'settings'" @select="onViewSelect" />
        <WorkspaceOpen v-if="currentView === 'workspace'" ref="workspaceView" />
        <SettingsWsAdd v-if="currentView === 'wsAdd'" />
        <SettingsWsConfig v-if="currentView === 'wsConfig'" ref="wsConfigView" @update:title="onWsConfigTitle" />
        <SettingsTab v-if="currentView === 'tab'" />
        <SettingsTerminal v-if="currentView === 'terminal'" />
        <SettingsEditor v-if="currentView === 'editor'" />
        <SettingsServerInfo v-if="currentView === 'server'" />
        <SettingsConfigFile v-if="currentView === 'config'" />

        <IconPicker
          v-if="currentView === 'iconPicker'"
          ref="iconPickerContent"
          @close="closeModal"
        />
        <WorkspaceDetail
          v-if="currentView === 'file'"
          ref="fileContent"
          @update:title="t => modalTitle = t"
          @update:back="b => modalBack = b"
          @close="closeModal"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from "vue";
import { useModal } from "../composables/useModal.js";
import SettingsMenu from "./SettingsMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import SettingsWsAdd from "./SettingsWsAdd.vue";
import SettingsWsConfig from "./SettingsWsConfig.vue";
import SettingsTab from "./SettingsTab.vue";
import SettingsTerminal from "./SettingsTerminal.vue";
import SettingsEditor from "./SettingsEditor.vue";
import SettingsServerInfo from "./SettingsServerInfo.vue";
import SettingsConfigFile from "./SettingsConfigFile.vue";
import IconPicker from "./IconPicker.vue";
import WorkspaceDetail from "./WorkspaceDetail.vue";
import { on } from "../app-bridge.js";

const SETTINGS_VIEW_TITLES = {
  workspace: "ワークスペース",
  wsAdd: "ワークスペース追加",
  wsConfig: "ワークスペース設定",
  tab: "タブ",
  terminal: "ターミナル",
  editor: "エディタ",
  config: "設定ファイル",
  server: "サーバー情報",
};

const modal = useModal();
const modalEl = ref(null);
const iconPickerContent = ref(null);
const fileContent = ref(null);
const workspaceView = ref(null);
const wsConfigView = ref(null);

const currentView = ref(null);
const modalTitle = ref("");
const modalBack = ref(false);
const wsConfigInDetail = ref(false);
let swipeSetup = false;

function openModal() {
  modal.open(modalEl.value, closeModal);
  nextTick(() => {
    if (currentView.value !== "iconPicker" && currentView.value !== "file" && modalEl.value && !swipeSetup) {
      modal.setupSwipeClose(modalEl.value, closeModal);
      swipeSetup = true;
    }
  });
}

function closeModal() {
  modal.close();
  currentView.value = null;
  modalTitle.value = "";
  modalBack.value = false;
  wsConfigInDetail.value = false;
  swipeSetup = false;
}

function onViewSelect({ view, title }) {
  currentView.value = view;
  modalTitle.value = title;
  modalBack.value = true;
  if (view === "workspace") {
    nextTick(() => workspaceView.value?.load());
  }
}

function settingsGoBack() {
  if (currentView.value === "wsConfig" && wsConfigInDetail.value) {
    wsConfigView.value?.goBackToList();
    wsConfigInDetail.value = false;
    modalTitle.value = "ワークスペース設定";
    return;
  }
  currentView.value = "settings";
  modalTitle.value = "設定";
  modalBack.value = false;
}

function onWsConfigTitle(title) {
  modalTitle.value = title;
  wsConfigInDetail.value = title !== "ワークスペース設定";
}

function onBack() {
  if (currentView.value === "file") {
    fileContent.value?.goBack();
  } else {
    settingsGoBack();
  }
}

function openSettings(view) {
  wsConfigInDetail.value = false;
  if (view) {
    currentView.value = view;
    modalTitle.value = SETTINGS_VIEW_TITLES[view] || "設定";
    modalBack.value = true;
    nextTick(() => {
      openModal();
      if (view === "workspace") workspaceView.value?.load();
    });
  } else {
    currentView.value = "settings";
    modalTitle.value = "設定";
    modalBack.value = false;
    nextTick(() => openModal());
  }
}

onMounted(() => {
  on("settings:open", (detail) => openSettings(detail?.view));
  on("settings:close", () => closeModal());

  on("iconPicker:open", ({ callback, currentIcon, currentColor }) => {
    currentView.value = "iconPicker";
    modalTitle.value = "アイコン選択";
    modalBack.value = false;
    nextTick(() => {
      openModal();
      iconPickerContent.value?.open(callback, currentIcon, currentColor);
    });
  });
  on("iconPicker:close", () => closeModal());

  on("git:openFileModal", (detail) => {
    currentView.value = "file";
    modalTitle.value = "Git";
    modalBack.value = true;
    nextTick(() => {
      openModal();
      fileContent.value?.open(detail);
    });
  });
  on("git:closeFileModal", () => closeModal());

  on("workspace:openModal", () => openSettings("workspace"));
  on("modal:close", () => closeModal());
});
</script>
