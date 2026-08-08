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
          <span class="modal-title-text">{{ modalTitle }}<template v-if="modalBranch"><span class="modal-title-sep"> / </span><span class="modal-title-branch" :data-tooltip="modalBranch">{{ modalBranch }}</span></template></span>
        </h3>
      </button>
      <!-- PCはサイドバー本体がインライン表示（オーバーレイではない）でEscの
           発見性が低いため、タイトル行の右端に明示的な閉じるボタンを置く
           （モバイルはModal.vue自身がオーバーレイの閉じるボタンを持つため
           対象外）。 -->
      <button
        v-if="!layoutStore.isPanelBottom"
        type="button"
        class="modal-close-btn"
        aria-label="Close sessions panel"
        data-tooltip="Close sessions panel"
        @click="closeNav"
      >&times;</button>
    </div>
    <div class="settings-panel-body">
      <SessionListView v-if="currentView === 'SessionList'" />
      <SessionPreviewTab v-if="currentView === 'SessionPreview'" />
      <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" />
      <ModalMenu v-if="currentView === 'ModalMenu'" />
      <WorkspaceAddView v-if="currentView === 'WorkspaceAdd'" />
      <WorkspaceEditPane v-if="currentView === 'WorkspaceEdit'" />
      <JobConfig v-if="currentView === 'JobConfig'" />
      <TerminalConfig v-if="currentView === 'TerminalConfig'" />
      <EditorConfig v-if="currentView === 'EditorConfig'" />
      <AuthConfig v-if="currentView === 'AuthConfig'" />
      <PairDeviceConfig v-if="currentView === 'PairDeviceConfig'" />
      <ServerInfo v-if="currentView === 'ServerInfo'" />
      <DisplayConfig v-if="currentView === 'DisplayConfig'" />
      <SendSnippet v-if="currentView === 'SendSnippet'" />
      <SendHistory v-if="currentView === 'SendHistory'" />
      <NotificationConfig v-if="currentView === 'NotificationConfig'" />
      <CircleKeyPadConfig v-if="currentView === 'CircleKeyPadConfig'" />
      <InfoPillConfig v-if="currentView === 'InfoPillConfig'" />
      <ConfigFile v-if="currentView === 'ConfigFile'" />
      <IconPicker v-if="currentView === 'IconPicker'" />
    </div>
  </div>
</template>

<script setup>
import { provide } from "vue";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import { useLayoutStore } from "../stores/layout.js";
import SessionListView from "./SessionListView.vue";
import SessionPreviewTab from "./SessionPreviewTab.vue";
import ModalMenu from "./ModalMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAddView from "./WorkspaceAddView.vue";
import WorkspaceEditPane from "./WorkspaceEditPane.vue";
import JobConfig from "./JobConfig.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import AuthConfig from "./AuthConfig.vue";
import PairDeviceConfig from "./PairDeviceConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import DisplayConfig from "./DisplayConfig.vue";
import SendSnippet from "./SendSnippet.vue";
import SendHistory from "./SendHistory.vue";
import NotificationConfig from "./NotificationConfig.vue";
import CircleKeyPadConfig from "./CircleKeyPadConfig.vue";
import InfoPillConfig from "./InfoPillConfig.vue";
import ConfigFile from "./ConfigFile.vue";
import IconPicker from "./IconPicker.vue";

// Modal.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使う設定画面の中身。ナビゲーション状態はuseSettingsNav.js
// （モジュールスコープの単一状態）を共有するため、表示場所が変わっても
// 同じビュースタックのまま続きから見える。WorkspaceDetailはuseWorkspaceDetailNav.js
// で完全に独立させているため、ここには含まれない（WorkspaceDetailModal.vue参照）。

const layoutStore = useLayoutStore();

const {
  currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, onBack, closeNav,
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

/* .modal-title-wrap / .modal-title / .modal-title-sep / .modal-title-branch /
   .modal-close-btn の見た目は ui/styles/modal-shell.css（グローバル）で
   WorkspaceDetailModal.vue と共用する。 */
.modal-title-wrap.is-clickable {
  cursor: pointer;
}

.modal-close-btn {
  margin-left: auto;
}

.modal-title-back-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  color: inherit;
}

.modal-title-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-panel-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 各ビューが使う .modal-scroll-body（スクロール本体）の契約は
   ui/styles/modal-shell.css の .settings-panel-body .modal-scroll-body 参照。 */
</style>
