<template>
  <nav
    v-if="isOpen"
    class="session-sidebar"
    aria-label="Sessions"
  >
    <SessionListPanel />
  </nav>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import SessionListPanel from "./SessionListPanel.vue";

// タブバー左端のハンバーガーで開くPC用サイドバー。中身（セッション一覧）は
// 共有のSessionListPanel.vue/useSessionListOverlay.tsに集約されており、この
// コンポーネントはコンテンツ左側に固定表示するための入れ物でしかない
// （モバイルはModal.vueが同じSessionListPanel.vueを全面オーバーレイで表示する）。
// Open Session/Settingsはタブバーの「+」/歯車ボタンから独立して開くため、
// このサイドバーはセッション一覧専用になっている。

const layoutStore = useLayoutStore();
const { close } = useSessionListOverlay();

// サイドバー用のスペースがあるかどうかは実際の画面幅（isNarrowViewport）で
// 判定する——タブバー位置の設定（isPanelBottom）とは独立（Wide画面でタブを
// Bottomに設定していても、幅があるならこちらを使う。Modal.vue参照）。
const isOpen = computed(() => layoutStore.isSessionSidebarOpen && !layoutStore.isNarrowViewport);

// Esc で閉じる（モバイルはModal.vue側のuseModalが同様のEscハンドリングを持つ）。
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!layoutStore.isSessionSidebarOpen) return;
  close();
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<style scoped>
.session-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 15; /* Modal.vue の .modal-overlay(z-index:20) より下、info-pills(10) より上 */
  width: var(--session-sidebar-width);
  max-width: 85vw;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  /* KeyboardBar.vue（ui/styles/keyboard-bar.css の .keyboard-bar）と同じ背景色に揃える。 */
  background: var(--bg-tertiary);
  border-right: 1px solid var(--border);
}
</style>
