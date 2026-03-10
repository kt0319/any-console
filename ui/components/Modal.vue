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
          class="modal-title-wrap"
          :class="{ 'is-clickable': canNavigateBack, 'no-back': !canNavigateBack }"
          :tabindex="canNavigateBack ? 0 : -1"
          :aria-disabled="!canNavigateBack ? 'true' : 'false'"
          @click="canNavigateBack ? onBack() : null"
        >
          <h3 class="modal-title">
            <span v-if="canNavigateBack" class="mdi mdi-arrow-left modal-title-back-icon" aria-hidden="true"></span>
            {{ modalTitle }}
          </h3>
        </button>
        <button type="button" class="modal-close-btn" @click="closeModal">&times;</button>
      </div>
      <div class="modal-body">
        <ModalMenu v-if="currentView === 'ModalMenu'" @select="onViewSelect" />
        <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" ref="workspaceOpenView" />
        <WorkspaceAdd v-if="currentView === 'WorkspaceAdd'" />
        <WorkspaceConfig v-if="currentView === 'WorkspaceConfig'" ref="workspaceConfigView" :initialWsName="wsConfigInitialWs" @openJobConfig="onOpenJobConfig" @openIconPicker="onWsIconPicker" />
        <JobConfig
          v-if="currentView === 'JobConfig'"
          :workspaceName="jobConfigState.workspaceName"
          :jobEntry="jobConfigState.jobEntry"
          :initialForm="jobConfigState.initialForm"
          @saved="onJobConfigSaved"
          @cancelled="onJobConfigCancelled"
          @openIconPicker="onJobIconPicker"
        />
        <TabConfig v-if="currentView === 'TabConfig'" />
        <TerminalConfig v-if="currentView === 'TerminalConfig'" />
        <EditorConfig v-if="currentView === 'EditorConfig'" />
        <ServerInfo v-if="currentView === 'ServerInfo'" />
        <GitHubPane v-if="currentView === 'GitHubPane'" ref="gitHubPaneView" />
        <GitLogGraph v-if="currentView === 'GitLogGraph'" ref="gitLogGraphView" />
        <ConfigFile v-if="currentView === 'ConfigFile'" />

        <IconPicker
          v-if="currentView === 'IconPicker'"
          ref="iconPickerView"
          @close="onIconPickerClose"
        />
        <WorkspaceDetail
          v-if="currentView === 'WorkspaceDetail'"
          ref="workspaceDetailView"
          @close="closeModal"
        />
      </div>
      <div
        class="modal-flick-handle"
        @touchstart.passive="onFlickStart"
        @touchmove="onFlickMove"
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
import { useSwipeDismiss } from "../composables/useSwipeDismiss.js";
import ModalMenu from "./ModalMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAdd from "./WorkspaceAdd.vue";
import WorkspaceConfig from "./WorkspaceConfig.vue";
import JobConfig from "./JobConfig.vue";
import TabConfig from "./TabConfig.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import ConfigFile from "./ConfigFile.vue";
import GitHubPane from "./GitHubPane.vue";
import GitLogGraph from "./GitLogGraph.vue";
import IconPicker from "./IconPicker.vue";
import WorkspaceDetail from "./WorkspaceDetail.vue";
import { on } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";

const workspaceStore = useWorkspaceStore();

const modal = useModal();
const modalEl = ref(null);
const iconPickerView = ref(null);
const workspaceDetailView = ref(null);
const workspaceOpenView = ref(null);
const workspaceConfigView = ref(null);
const gitHubPaneView = ref(null);
const gitLogGraphView = ref(null);
let iconPickerReturnView = null;
let wsIconPickerResult = null;

const currentView = ref(null);
const modalTitle = ref("");
const canNavigateBack = ref(false);
const jobConfigState = ref({ workspaceName: "", jobEntry: null });
const wsConfigInitialWs = ref("");

provide("modalTitle", modalTitle);
const {
  resetStyle: resetFlickStyle,
  onStart: onFlickStart,
  onMove: onFlickMove,
  onEnd: onFlickEnd,
  onCancel: onFlickCancel,
} = useSwipeDismiss(modalEl, () => closeModal(), { threshold: 80 });

function openModal() {
  modal.open(modalEl.value, closeModal);
}

function closeModal() {
  resetFlickStyle();
  modal.close();
  currentView.value = null;
  modalTitle.value = "";
  canNavigateBack.value = false;
}

function onViewSelect({ view }) {
  if (view === "WorkspaceConfig") wsConfigInitialWs.value = "";
  currentView.value = view;
  canNavigateBack.value = true;
  if (view === "WorkspaceOpen") {
    nextTick(() => workspaceOpenView.value?.load());
  }
}

function settingsGoBack() {
  if (currentView.value === "WorkspaceConfig" && workspaceConfigView.value?.editWs) {
    workspaceConfigView.value?.goBackToList();
    return;
  }
  currentView.value = "ModalMenu";
  canNavigateBack.value = false;
}

function onBack() {
  if (currentView.value === "IconPicker" && iconPickerReturnView === "JobConfig") {
    iconPickerReturnView = null;
    currentView.value = "JobConfig";
    canNavigateBack.value = true;
    return;
  }
  if (currentView.value === "IconPicker" && iconPickerReturnView === "WorkspaceConfig") {
    iconPickerReturnView = null;
    wsIconPickerResult = null;
    backToWorkspaceConfig();
    return;
  }
  if (currentView.value === "JobConfig") {
    backToWorkspaceConfig();
  } else if (currentView.value === "GitHubPane") {
    currentView.value = "WorkspaceDetail";
    canNavigateBack.value = true;
    nextTick(() => {
      workspaceDetailView.value?.open();
    });
  } else if (currentView.value === "GitLogGraph") {
    currentView.value = "WorkspaceDetail";
    canNavigateBack.value = true;
    nextTick(() => {
      workspaceDetailView.value?.open();
    });
  } else if (currentView.value === "WorkspaceDetail") {
    workspaceDetailView.value?.goBack();
  } else {
    settingsGoBack();
  }
}

function backToWorkspaceConfig() {
  wsConfigInitialWs.value = jobConfigState.value.workspaceName || "";
  currentView.value = "WorkspaceConfig";
  canNavigateBack.value = true;
}

function onOpenJobConfig({ workspaceName, jobEntry }) {
  jobConfigState.value = { workspaceName, jobEntry, initialForm: null };
  currentView.value = "JobConfig";
  canNavigateBack.value = true;
}

function onJobConfigSaved() {
  backToWorkspaceConfig();
}

function onJobConfigCancelled() {
  backToWorkspaceConfig();
}

function onJobIconPicker({ currentIcon, currentColor, formSnapshot }) {
  iconPickerReturnView = "JobConfig";
  jobConfigState.value.initialForm = formSnapshot;
  currentView.value = "IconPicker";
  canNavigateBack.value = true;
  nextTick(() => {
    iconPickerView.value?.open((icon, color) => {
      jobConfigState.value.initialForm = { ...jobConfigState.value.initialForm, icon, icon_color: color };
    }, currentIcon, currentColor);
  });
}

function onWsIconPicker({ currentIcon, currentColor }) {
  iconPickerReturnView = "WorkspaceConfig";
  currentView.value = "IconPicker";
  canNavigateBack.value = true;
  nextTick(() => {
    iconPickerView.value?.open((icon, color) => {
      wsIconPickerResult = { icon, color };
    }, currentIcon, currentColor);
  });
}

function onIconPickerClose() {
  if (iconPickerReturnView === "JobConfig") {
    iconPickerReturnView = null;
    currentView.value = "JobConfig";
    canNavigateBack.value = true;
  } else if (iconPickerReturnView === "WorkspaceConfig") {
    iconPickerReturnView = null;
    backToWorkspaceConfig();
    nextTick(() => {
      if (wsIconPickerResult) {
        workspaceConfigView.value?.applyIcon(wsIconPickerResult.icon, wsIconPickerResult.color);
        wsIconPickerResult = null;
      }
    });
  } else {
    closeModal();
  }
}

function openSettings(view) {
  if (view) {
    currentView.value = view;
    canNavigateBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => {
        if (view === "WorkspaceOpen") workspaceOpenView.value?.load();
      });
    });
  } else {
    currentView.value = "ModalMenu";
    canNavigateBack.value = false;
    nextTick(() => openModal());
  }
}

onMounted(() => {
  on("settings:open", (detail) => openSettings(detail?.view));
  on("settings:close", () => closeModal());

  on("iconPicker:open", ({ callback, currentIcon, currentColor }) => {
    currentView.value = "IconPicker";
    canNavigateBack.value = false;
    nextTick(() => {
      openModal();
      nextTick(() => {
        iconPickerView.value?.open(callback, currentIcon, currentColor);
      });
    });
  });
  on("iconPicker:close", () => closeModal());

  on("git:openFileModal", (detail) => {
    currentView.value = "WorkspaceDetail";
    canNavigateBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => {
        workspaceDetailView.value?.open(detail);
      });
    });
  });
  on("git:closeFileModal", () => closeModal());

  on("workspace:openModal", () => openSettings("WorkspaceOpen"));

  on("git:openGitHub", () => {
    currentView.value = "GitHubPane";
    canNavigateBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => gitHubPaneView.value?.load());
    });
  });

  on("git:openLogGraph", () => {
    currentView.value = "GitLogGraph";
    canNavigateBack.value = true;
    nextTick(() => {
      openModal();
      nextTick(() => gitLogGraphView.value?.load());
    });
  });

  on("modal:close", () => closeModal());
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}

.modal {
  background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 8px 0;
  width: 100%;
  max-width: min(600px, 92vw);
  height: calc(var(--app-dvh) * 0.8);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
}

.modal-title-wrap {
  display: inline-flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  justify-content: flex-start;
}

.modal-title-wrap .modal-title {
  font-size: 15px;
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  text-align: left;
}

.modal-title-wrap.is-clickable {
  cursor: pointer;
}

.modal-title-back-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  color: inherit;
}

.modal-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

:deep(.modal-scroll-body) {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 0 8px;
}

.modal-flick-handle {
  display: none;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  touch-action: none;
}

.modal-flick-bar {
  width: 48px;
  height: 5px;
  border-radius: 3px;
  background: var(--text-muted);
  opacity: 0.5;
}

.modal-close-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  flex-shrink: 0;
  padding: 0;
  font-size: 22px;
  line-height: 1;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
}

@media (min-width: 900px) {
  .modal-overlay {
    padding: 28px;
  }

  .modal {
    max-width: min(900px, 90vw);
    height: calc(var(--app-dvh) * 0.84);
  }
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
    align-items: flex-start;
  }

  .modal {
    max-width: 100%;
    height: calc(var(--app-dvh) - 28px);
    border: none;
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .modal-flick-handle {
    display: flex;
    padding: 10px 0 calc(env(safe-area-inset-bottom) + 40px);
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  }
}
</style>
