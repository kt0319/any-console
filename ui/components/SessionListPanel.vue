<template>
  <div class="settings-panel">
    <ModalHeader
      title="Sessions"
      close-label="Close sessions panel"
      :panel-bottom="panelBottom"
      @close="close"
    />
    <div class="settings-panel-body pane-fill" :class="{ 'panel-bottom': panelBottom }">
      <SessionListView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import ModalHeader from "./ModalHeader.vue";
import SessionListView from "./SessionListView.vue";

// Modal.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使うセッション一覧の中身。Open Session/Settingsはここから
// 分離済みのため、SessionListView.vueをホストするだけの薄いラッパーになって
// いる。ヘッダーはModalShell.vueと共通のModalHeader.vue（タイトル+閉じる
// ボタン。戻る機能は無いのでcanBackは渡さない＝falseのまま）。
// panelBottomは呼び出し元がヘッダーを上部/下部どちらに寄せるか渡す
// （Modal.vue経由＝実際のタブ位置設定、SessionSidebar.vue経由＝常にfalse
// 固定。インラインサイドバーは常に上部固定のため）。

defineProps<{
  panelBottom?: boolean,
}>();

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
  order: 0;
}

.settings-panel-header.panel-bottom {
  order: 1;
}

.settings-panel-body {
  order: 1;
}

.settings-panel-body.panel-bottom {
  order: 0;
}
</style>
