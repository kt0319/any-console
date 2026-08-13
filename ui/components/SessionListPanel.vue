<template>
  <div class="settings-panel">
    <div class="settings-panel-header">
      <button type="button" class="modal-title-wrap no-back" tabindex="-1" aria-disabled="true">
        <h3 class="modal-title">
          <span class="modal-title-text">Sessions</span>
        </h3>
      </button>
      <button
        v-if="!layoutStore.isPanelBottom"
        type="button"
        class="modal-close-btn"
        aria-label="Close sessions panel"
        data-tooltip="Close sessions panel"
        @click="close"
      >&times;</button>
    </div>
    <div class="settings-panel-body">
      <SessionListView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLayoutStore } from "../stores/layout.ts";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import SessionListView from "./SessionListView.vue";

// Modal.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使うセッション一覧の中身。Open Session/Settingsはここから
// 分離済みのため、SessionListView.vueをそのままホストするだけの薄い
// ラッパーになっている（タイトル固定"Sessions"）。

const layoutStore = useLayoutStore();
const { close } = useSessionListOverlay();
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

/* .modal-title / .modal-close-btn の見た目は ui/styles/modal-shell.css
   （グローバル）で他のオーバーレイと共用する。 */
.modal-close-btn {
  margin-left: auto;
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
</style>
