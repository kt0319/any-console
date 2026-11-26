<template>
  <div
    v-if="modal.visible.value"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @mousedown.self="close"
  >
    <div ref="modalEl" class="modal">
      <SessionListPanel ref="panelRef" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useModal } from "../composables/useModal.ts";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import { useLayoutStore } from "../stores/layout.ts";
import SessionListPanel from "./SessionListPanel.vue";

// モバイル専用オーバーレイ（中身は SessionListPanel.vue / useSessionListOverlay.ts）。PCは SessionSidebar.vue へ直接インライン表示する。

const modal = useModal();
const layoutStore = useLayoutStore();
const { close } = useSessionListOverlay();
const modalEl = ref<HTMLElement | null>(null);
const panelRef = ref<InstanceType<typeof SessionListPanel> | null>(null);

// isSessionSidebarOpen かつ画面が狭い時だけ、フォーカストラップ・Esc 付きオーバーレイとして開閉する。
// 狭さは実際の画面幅（isNarrowViewport）で判定し、タブバー位置設定（isTabBarAtBottom）とは独立させる。
watch(
  () => layoutStore.isSessionSidebarOpen && layoutStore.isNarrowViewport,
  (shouldShow) => {
    if (shouldShow) {
      modal.open(() => modalEl.value, close);
    } else if (modal.visible.value) {
      modal.close();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
/* .modal-overlay の配置・背景は ui/styles/modal-shell.css で WorkspaceDetailModal.vue と共用する。 */
.modal {
  position: relative;
  background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
  padding: 0;
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
</style>
