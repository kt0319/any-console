<template>
  <div
    v-if="isOpen"
    class="modal-overlay terminal-settings-modal"
    role="dialog"
    aria-modal="true"
    @mousedown.self="close"
  >
    <div ref="modalEl" class="modal">
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
        <button
          type="button"
          class="modal-close-btn"
          aria-label="Close settings"
          data-tooltip="Close settings"
          @click="close"
        >&times;</button>
      </div>
      <div class="settings-panel-body">
        <ModalMenu v-if="currentView === 'ModalMenu'" />
        <SessionPreviewTab v-if="currentView === 'SessionPreview'" />
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, watch } from "vue";
import { useModal } from "../composables/useModal.ts";
import { useSettingsNav } from "../composables/useSettingsNav.ts";
import ModalMenu from "./ModalMenu.vue";
import SessionPreviewTab from "./SessionPreviewTab.vue";
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

// タブバーの歯車ボタンから開くSettings系列専用の全面オーバーレイ。
// WorkspaceDetailModal.vue/SessionOpenModal.vueと同じシェル
// （.modal-overlay/.modal/.settings-panel-header/.settings-panel-body）を
// 使い、ナビゲーションはuseSettingsNav.js（Open Session/セッション一覧とは
// 完全に独立したビュースタック）を使う。

const modal = useModal();
const {
  isOpen, currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, onBack, closeNav,
} = useSettingsNav();

provide("modalTitle", modalTitle);
provide("modalBranch", modalBranch);
provide("viewState", currentState);
provide("pushView", pushView);
provide("popView", popView);
provide("updateViewState", updateViewState);

const modalEl = ref<HTMLElement | null>(null);

function close() {
  closeNav();
}

watch(
  isOpen,
  (shouldShow) => {
    if (shouldShow) {
      modal.open(() => modalEl.value, close);
    } else if (modal.visible.value) {
      modal.close();
    }
  },
);

defineExpose({ onBack });
</script>

<style scoped>
/* .modal-overlay / .modal-title系 / .modal-close-btn の共通の見た目は
   ui/styles/modal-shell.css（グローバル）で他のオーバーレイと共用する。
   ここには固有の差分だけを置く。 */
.modal {
  background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
  width: 100%;
  max-width: 100%;
  height: 100%;
  border: none;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.settings-panel-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
  order: 1;
}

@media (min-width: 769px) {
  .settings-panel-header {
    border-bottom: 1px solid var(--border);
    border-top: none;
    padding-bottom: 0;
    order: 0;
  }
}

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
  order: 0;
}

@media (min-width: 769px) {
  .settings-panel-body {
    order: 1;
  }
}

/* 各ペインが使う .modal-scroll-body（スクロール本体）の契約は
   ui/styles/modal-shell.css の .settings-panel-body .modal-scroll-body 参照。 */
</style>
