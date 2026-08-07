<template>
  <div class="settings-panel">
    <div class="settings-panel-header">
      <button
        type="button"
        class="modal-title-wrap"
        :class="{ 'is-clickable': canNavigateBack, 'no-back': !canNavigateBack }"
        :tabindex="canNavigateBack ? 0 : -1"
        :aria-disabled="!canNavigateBack ? 'true' : 'false'"
        @click="canNavigateBack && onBack()"
      >
        <h3 class="modal-title">
          <span v-if="canNavigateBack" class="mdi mdi-arrow-left modal-title-back-icon" aria-hidden="true"></span>
          {{ modalTitle }}<template v-if="modalBranch"><span class="modal-title-sep"> / </span><span class="modal-title-branch" :data-tooltip="modalBranch">{{ modalBranch }}</span></template>
        </h3>
      </button>
    </div>
    <div class="settings-panel-body">
      <SessionListView v-if="currentView === 'SessionList'" />
      <ModalMenu v-if="currentView === 'ModalMenu'" />
      <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" />
      <WorkspaceAddView v-if="currentView === 'WorkspaceAdd'" />
      <WorkspaceEditPane v-if="currentView === 'WorkspaceEdit'" />
      <JobConfig v-if="currentView === 'JobConfig'" />
      <TabConfig v-if="currentView === 'TabConfig'" />
      <DispatchQueueConfig v-if="currentView === 'DispatchQueueConfig'" />
      <DispatchRunView v-if="currentView === 'DispatchRunView'" />
      <TerminalConfig v-if="currentView === 'TerminalConfig'" />
      <EditorConfig v-if="currentView === 'EditorConfig'" />
      <AuthConfig v-if="currentView === 'AuthConfig'" />
      <PairDeviceConfig v-if="currentView === 'PairDeviceConfig'" />
      <ServerInfo v-if="currentView === 'ServerInfo'" />
      <DisplayConfig v-if="currentView === 'DisplayConfig'" />
      <SendSnippet v-if="currentView === 'SendSnippet'" />
      <SendHistory v-if="currentView === 'SendHistory'" />
      <PreviewPorts v-if="currentView === 'PreviewPorts'" />
      <NotificationConfig v-if="currentView === 'NotificationConfig'" />
      <CircleKeyPadConfig v-if="currentView === 'CircleKeyPadConfig'" />
      <InfoPillConfig v-if="currentView === 'InfoPillConfig'" />
      <ConfigFile v-if="currentView === 'ConfigFile'" />
      <IconPicker v-if="currentView === 'IconPicker'" />
      <WorkspaceDetail v-if="currentView === 'WorkspaceDetail'" :ref="setPaneRef" />
    </div>
  </div>
</template>

<script setup>
import { provide } from "vue";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import SessionListView from "./SessionListView.vue";
import ModalMenu from "./ModalMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAddView from "./WorkspaceAddView.vue";
import WorkspaceEditPane from "./WorkspaceEditPane.vue";
import JobConfig from "./JobConfig.vue";
import TabConfig from "./TabConfig.vue";
import DispatchQueueConfig from "./DispatchQueueConfig.vue";
import DispatchRunView from "./DispatchRunView.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import AuthConfig from "./AuthConfig.vue";
import PairDeviceConfig from "./PairDeviceConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import DisplayConfig from "./DisplayConfig.vue";
import SendSnippet from "./SendSnippet.vue";
import SendHistory from "./SendHistory.vue";
import PreviewPorts from "./PreviewPorts.vue";
import NotificationConfig from "./NotificationConfig.vue";
import CircleKeyPadConfig from "./CircleKeyPadConfig.vue";
import InfoPillConfig from "./InfoPillConfig.vue";
import ConfigFile from "./ConfigFile.vue";
import IconPicker from "./IconPicker.vue";
import WorkspaceDetail from "./WorkspaceDetail.vue";

// Modal.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使う設定画面の中身。ナビゲーション状態はuseSettingsNav.js
// （モジュールスコープの単一状態）を共有するため、表示場所が変わっても
// 同じビュースタックのまま続きから見える。

const {
  currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, onBack, setPaneRef,
} = useSettingsNav();

provide("modalTitle", modalTitle);
provide("modalBranch", modalBranch);
provide("viewState", currentState);
provide("pushView", pushView);
provide("popView", popView);
provide("updateViewState", updateViewState);

defineExpose({ onBack });
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.settings-panel-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.modal-title-wrap {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
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

.modal-title-sep {
  color: var(--text-muted);
}

.modal-title-branch {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 400;
}

.settings-panel-body {
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
</style>
