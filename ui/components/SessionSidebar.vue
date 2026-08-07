<template>
  <nav
    v-if="isOpen"
    class="session-sidebar"
    aria-label="Sessions"
  >
    <SettingsPanel />
  </nav>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useLayoutStore } from "../stores/layout.js";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import SettingsPanel from "./SettingsPanel.vue";

// タブバー左端のハンバーガーで開くPC用サイドバー。中身（セッション一覧+
// 設定）は共有のSettingsPanel.vue/useSettingsNav.jsに集約されており、この
// コンポーネントはコンテンツ左側に固定表示するための入れ物でしかない
// （モバイルはModal.vueが同じSettingsPanel.vueを全面オーバーレイで表示する）。
//
// PCでは歯車ボタンを廃止し、ハンバーガー1つでこのサイドバーを開閉する。
// ナビゲーションのルートは常にセッション一覧（SessionListView）で、
// 設定へ進むと一覧は隠れ、戻ると一覧に戻る（一覧と設定を同時に出さない）。

const layoutStore = useLayoutStore();
const { closeNav } = useSettingsNav();

// 分割モード中はタブバー（ハンバーガー）自体が隠れるため、サイドバーも出さない。
const isOpen = computed(() => layoutStore.isSessionSidebarOpen && !layoutStore.isSplitMode && !layoutStore.isPanelBottom);

// Esc で閉じる（モバイルはModal.vue側のuseModalが同様のEscハンドリングを持つ）。
// closeNavでビュースタックもSessionListへ戻しておく（×ボタンと同じ挙動。
// 単にisSessionSidebarOpenだけ倒すと、次回開いた時に前回の設定画面の
// 続きから表示されてしまうため）。
function onKeydown(e) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!layoutStore.isSessionSidebarOpen) return;
  closeNav();
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
  width: 280px;
  max-width: 85vw;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}
</style>
