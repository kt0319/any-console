<template>
  <nav
    v-if="isOpen"
    class="session-sidebar"
    aria-label="Sessions"
  >
    <SessionListPanel />
  </nav>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useLayoutStore } from "../stores/layout.js";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.js";
import SessionListPanel from "./SessionListPanel.vue";

// タブバー左端のハンバーガーで開くPC用サイドバー。中身（セッション一覧）は
// 共有のSessionListPanel.vue/useSessionListOverlay.jsに集約されており、この
// コンポーネントはコンテンツ左側に固定表示するための入れ物でしかない
// （モバイルはModal.vueが同じSessionListPanel.vueを全面オーバーレイで表示する）。
// Open Session/Settingsはタブバーの「+」/歯車ボタンから独立して開くため、
// このサイドバーはセッション一覧専用になっている。

const layoutStore = useLayoutStore();
const { close } = useSessionListOverlay();

const isOpen = computed(() => layoutStore.isSessionSidebarOpen && !layoutStore.isPanelBottom);

// Esc で閉じる（モバイルはModal.vue側のuseModalが同様のEscハンドリングを持つ）。
function onKeydown(e) {
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
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}
</style>
