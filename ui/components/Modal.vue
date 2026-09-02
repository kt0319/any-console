<template>
  <div
    v-if="modal.visible.value"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @mousedown.self="close"
  >
    <div ref="modalEl" class="modal" :class="{ 'panel-bottom': layoutStore.isPanelBottom }">
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

// モバイル専用のオーバーレイ表示。中身はSessionListPanel.vue/
// useSessionListOverlay.tsに集約されており、PCではこのオーバーレイを使わず
// SessionSidebar.vueへ直接インライン表示する。Open Session/Settingsは
// SessionOpenModal.vue/TerminalSettingsModal.vueが別途タブバーのボタンから開く。

const modal = useModal();
const layoutStore = useLayoutStore();
const { close } = useSessionListOverlay();
const modalEl = ref<HTMLElement | null>(null);
const panelRef = ref<InstanceType<typeof SessionListPanel> | null>(null);

// isSessionSidebarOpen（ハンバーガーで開閉）かつ画面が狭い時だけ、
// フォーカストラップ・Escハンドリング付きのオーバーレイとして開閉する。
// サイドバー用のスペースがあるかどうかは実際の画面幅（isNarrowViewport）で
// 判定する——タブバー位置の設定（isPanelBottom）とは独立（Wide画面でタブを
// Bottomに設定していても、幅があるならインラインサイドバーを使う）。
// PCはSessionSidebar.vue側が同じisSessionSidebarOpenを見て自身のサイドバー
// を開くだけで、このオーバーレイ自体は使わない。
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
/* .modal-overlay の配置・背景は ui/styles/modal-shell.css（グローバル）で
   WorkspaceDetailModal.vue と共用する。 */
.modal {
  position: relative;
  background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
  padding: 12px 8px 0;
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

/* セッションタブがボトム配置（Settings > Display）の時だけヘッダーが下部
   （ボトムシート風）に来る。閉じるボタンはSessionListPanel.vue自身の
   ヘッダー（左端）にPC/モバイル共通で出す。このコンポーネント自体は画面が
   狭い時だけ開くオーバーレイ（isNarrowViewport、上のwatch参照）だが、
   ヘッダー位置自体は画面幅ではなく実際のタブ位置設定（isPanelBottom）に
   連動させることで、タブ位置とヘッダー位置の見た目を常に揃える。 */
:deep(.settings-panel-header) {
  border-bottom: 1px solid var(--border);
  border-top: none;
  padding-bottom: 0;
  order: 0;
}

:deep(.settings-panel-body) {
  order: 1;
}

.modal.panel-bottom :deep(.settings-panel-header) {
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
  order: 1;
}

.modal.panel-bottom :deep(.settings-panel-body) {
  order: 0;
}
</style>
