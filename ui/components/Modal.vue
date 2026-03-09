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
        <button v-if="modalBack" type="button" class="modal-back-btn" @click="onBack">
          <span class="mdi mdi-arrow-left"></span>
        </button>
        <h3 class="modal-title" :class="{ 'modal-title-clickable': modalBack }" @click="modalBack ? onBack() : null">{{ modalTitle }}</h3>
        <button type="button" class="modal-close-btn" @click="closeModal">&times;</button>
      </div>
      <div class="modal-body">
        <ModalMenu v-if="currentView === 'ModalMenu'" @select="onViewSelect" />
        <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" ref="workspaceView" />
        <WorkspaceAdd v-if="currentView === 'WorkspaceAdd'" />
        <WorkspaceConfig v-if="currentView === 'WorkspaceConfig'" ref="wsConfigView" />
        <TabConfig v-if="currentView === 'TabConfig'" />
        <TerminalConfig v-if="currentView === 'TerminalConfig'" />
        <EditorConfig v-if="currentView === 'EditorConfig'" />
        <ServerInfo v-if="currentView === 'ServerInfo'" />
        <GitHubPane v-if="currentView === 'GitHubPane'" ref="gitGitHubView" />
        <ConfigFile v-if="currentView === 'ConfigFile'" />

        <IconPicker
          v-if="currentView === 'IconPicker'"
          ref="iconPickerContent"
          @close="closeModal"
        />
        <WorkspaceDetail
          v-if="currentView === 'WorkspaceDetail'"
          ref="fileContent"
          @close="closeModal"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, provide, nextTick, onMounted } from "vue";
import { useModal } from "../composables/useModal.js";
import ModalMenu from "./ModalMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAdd from "./WorkspaceAdd.vue";
import WorkspaceConfig from "./WorkspaceConfig.vue";
import TabConfig from "./TabConfig.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import ConfigFile from "./ConfigFile.vue";
import GitHubPane from "./GitHubPane.vue";
import IconPicker from "./IconPicker.vue";
import WorkspaceDetail from "./WorkspaceDetail.vue";
import { on } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";

const workspaceStore = useWorkspaceStore();

const modal = useModal();
const modalEl = ref(null);
const iconPickerContent = ref(null);
const fileContent = ref(null);
const workspaceView = ref(null);
const wsConfigView = ref(null);
const gitGitHubView = ref(null);

const currentView = ref(null);
const modalTitle = ref("");
const modalBack = ref(false);

provide("modalTitle", modalTitle);
let swipeSetup = false;

function openModal() {
  modal.open(modalEl.value, closeModal);
  nextTick(() => {
    if (currentView.value !== "IconPicker" && currentView.value !== "WorkspaceDetail" && modalEl.value && !swipeSetup) {
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
  swipeSetup = false;
}

function onViewSelect({ view }) {
  currentView.value = view;
  modalBack.value = true;
  if (view === "WorkspaceOpen") {
    nextTick(() => workspaceView.value?.load());
  }
}

function settingsGoBack() {
  if (currentView.value === "WorkspaceConfig" && wsConfigView.value?.editWs) {
    wsConfigView.value?.goBackToList();
    return;
  }
  currentView.value = "ModalMenu";
  modalBack.value = false;
}

function onBack() {
  if (currentView.value === "GitHubPane") {
    currentView.value = "WorkspaceDetail";
    modalBack.value = true;
    nextTick(() => {
      fileContent.value?.open();
    });
  } else if (currentView.value === "WorkspaceDetail") {
    fileContent.value?.goBack();
  } else {
    settingsGoBack();
  }
}

function openSettings(view) {
  if (view) {
    currentView.value = view;
    modalBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => {
        if (view === "WorkspaceOpen") workspaceView.value?.load();
      });
    });
  } else {
    currentView.value = "ModalMenu";
    modalBack.value = false;
    nextTick(() => openModal());
  }
}

onMounted(() => {
  on("settings:open", (detail) => openSettings(detail?.view));
  on("settings:close", () => closeModal());

  on("iconPicker:open", ({ callback, currentIcon, currentColor }) => {
    currentView.value = "IconPicker";
    modalBack.value = false;
    nextTick(() => {
      openModal();
      nextTick(() => {
        iconPickerContent.value?.open(callback, currentIcon, currentColor);
      });
    });
  });
  on("iconPicker:close", () => closeModal());

  on("git:openFileModal", (detail) => {
    currentView.value = "WorkspaceDetail";
    modalBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => {
        fileContent.value?.open(detail);
      });
    });
  });
  on("git:closeFileModal", () => closeModal());

  on("workspace:openModal", () => openSettings("WorkspaceOpen"));

  on("git:openGitHub", () => {
    currentView.value = "GitHubPane";
    modalBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => gitGitHubView.value?.load());
    });
  });

  on("modal:close", () => closeModal());
});
</script>
