<template>
  <div
    v-if="isOpen"
    class="modal-overlay session-open-modal"
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
          aria-label="Close open session"
          data-tooltip="Close open session"
          @click="close"
        >&times;</button>
      </div>
      <div class="settings-panel-body">
        <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" />
        <WorkspaceAddView v-if="currentView === 'WorkspaceAdd'" />
        <WorkspaceEditPane v-if="currentView === 'WorkspaceEdit'" />
        <JobConfig v-if="currentView === 'JobConfig'" />
        <IconPicker v-if="currentView === 'IconPicker'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, provide, watch } from "vue";
import { useModal } from "../composables/useModal.ts";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAddView from "./WorkspaceAddView.vue";
import WorkspaceEditPane from "./WorkspaceEditPane.vue";
import JobConfig from "./JobConfig.vue";
import IconPicker from "./IconPicker.vue";

// タブバーの「+」ボタンから開くOpen Session系列（WorkspaceOpen/WorkspaceAdd/
// WorkspaceEdit/JobConfig/IconPicker）専用の全面オーバーレイ。
// WorkspaceDetailModal.vueと同じシェル（.modal-overlay/.modal/
// .settings-panel-header/.settings-panel-body）を使い、ナビゲーションは
// useSessionOpenNav.ts（Settings/セッション一覧とは完全に独立したビュー
// スタック）を使う。

const modal = useModal();
const {
  isOpen, currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, onBack, closeNav,
} = useSessionOpenNav();

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
