<template>
  <div class="settings-panel">
    <div class="settings-panel-header">
      <button
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
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import SessionListView from "./SessionListView.vue";

// Modal.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使うセッション一覧の中身。Open Session/Settingsはここから
// 分離済みのため、SessionListView.vueをそのままホストするだけの薄い
// ラッパーになっている（タイトルは出さず閉じるボタンのみ。モバイル/PC共通で
// ヘッダー左端に閉じるボタンを出す）。

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
  min-height: 44px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

/* .modal-close-btn の見た目は ui/styles/modal-shell.css（グローバル）で
   他のオーバーレイと共用する。タイトルを出さないため左端に置く。 */

.settings-panel-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
