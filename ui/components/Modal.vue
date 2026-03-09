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
        <button
          type="button"
          class="modal-back-btn"
          :class="{ 'is-placeholder': !modalBack }"
          :disabled="!modalBack"
          :tabindex="modalBack ? 0 : -1"
          :aria-hidden="!modalBack ? 'true' : 'false'"
          @click="modalBack ? onBack() : null"
        >
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
        <GitCommitGraph v-if="currentView === 'GitCommitGraph'" ref="gitGraphView" />
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
      <div
        class="modal-flick-handle"
        @touchstart.passive="onFlickStart"
        @touchmove.prevent="onFlickMove"
        @touchend="onFlickEnd"
        @touchcancel="onFlickCancel"
      >
        <span class="modal-flick-bar"></span>
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
import GitCommitGraph from "./GitCommitGraph.vue";
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
const gitGraphView = ref(null);

const currentView = ref(null);
const modalTitle = ref("");
const modalBack = ref(false);

provide("modalTitle", modalTitle);
let flickStartY = 0;
let flickCurrentY = 0;
let flickDragging = false;
const FLICK_THRESHOLD = 80;

function openModal() {
  modal.open(modalEl.value, closeModal);
}

function closeModal() {
  resetFlickStyle();
  modal.close();
  currentView.value = null;
  modalTitle.value = "";
  modalBack.value = false;
}

function resetFlickStyle() {
  if (!modalEl.value) return;
  modalEl.value.style.transform = "";
  modalEl.value.style.opacity = "";
  modalEl.value.style.transition = "";
}

function onFlickStart(e) {
  if (!modalEl.value) return;
  flickStartY = e.touches[0].clientY;
  flickCurrentY = flickStartY;
  flickDragging = true;
  modalEl.value.style.transition = "none";
}

function onFlickMove(e) {
  if (!flickDragging || !modalEl.value) return;
  flickCurrentY = e.touches[0].clientY;
  const dy = flickCurrentY - flickStartY;
  modalEl.value.style.transform = `translateY(${dy}px)`;
  modalEl.value.style.opacity = String(Math.max(0.2, 1 - Math.abs(dy) / 400));
}

function onFlickEnd() {
  if (!flickDragging || !modalEl.value) return;
  flickDragging = false;
  const dy = flickCurrentY - flickStartY;
  if (Math.abs(dy) > FLICK_THRESHOLD) {
    const endY = dy >= 0 ? "100%" : "-100%";
    modalEl.value.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
    modalEl.value.style.transform = `translateY(${endY})`;
    modalEl.value.style.opacity = "0";
    modalEl.value.addEventListener("transitionend", () => {
      resetFlickStyle();
      closeModal();
    }, { once: true });
    return;
  }
  modalEl.value.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
  modalEl.value.style.transform = "";
  modalEl.value.style.opacity = "";
  modalEl.value.addEventListener("transitionend", () => {
    if (!modalEl.value) return;
    modalEl.value.style.transition = "";
  }, { once: true });
}

function onFlickCancel() {
  if (!flickDragging) return;
  flickDragging = false;
  resetFlickStyle();
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
  } else if (currentView.value === "GitCommitGraph") {
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

  on("git:openCommitGraph", () => {
    currentView.value = "GitCommitGraph";
    modalBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => gitGraphView.value?.load());
    });
  });

  on("modal:close", () => closeModal());
});
</script>
