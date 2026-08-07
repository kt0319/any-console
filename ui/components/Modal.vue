<template>
  <div
    v-if="modal.visible.value"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @mousedown.self="closeNav"
  >
    <div ref="modalEl" class="modal">
      <SettingsPanel ref="panelRef" />
      <button
        type="button"
        class="modal-close-fab"
        aria-label="Close"
        data-tooltip="Close"
        @click="closeNav"
      >&times;</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useModal } from "../composables/useModal.js";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import { useLayoutStore } from "../stores/layout.js";
import SettingsPanel from "./SettingsPanel.vue";

// モバイル専用のオーバーレイ表示。設定画面の中身・ナビゲーション状態は
// SettingsPanel.vue / useSettingsNav.js に集約されており、PCではこの
// オーバーレイを使わずSessionSidebar.vueへ直接インライン表示する
// （歯車ボタン廃止・ハンバーガー1つにセッション一覧+設定を統合）。

const modal = useModal();
const layoutStore = useLayoutStore();
const { closeNav } = useSettingsNav();
const modalEl = ref(null);
const panelRef = ref(null);

// isSessionSidebarOpen（ハンバーガーで開閉）かつモバイルの時だけ、
// フォーカストラップ・Escハンドリング付きのオーバーレイとして開閉する。
// ナビゲーションのルートは常にSessionList（セッション一覧）で、設定へ
// 進んでも同じオーバーレイ内でビューが変わるだけ（isSessionSidebarOpen
// 自体は開いたまま）。PCはSessionSidebar.vue側が同じisSessionSidebarOpen
// を見て自身のサイドバーを開くだけで、このオーバーレイ自体は使わない。
watch(
  () => layoutStore.isSessionSidebarOpen && layoutStore.isPanelBottom,
  (shouldShow) => {
    if (shouldShow) {
      modal.open(() => modalEl.value, closeNav);
    } else if (modal.visible.value) {
      modal.close();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
/* ScreenMain.vue の .content-area（TabBar/ステータスバー/KeyboardBar の外側 = ターミナル表示
   エリアと全く同じ場所）内に配置する。position:fixed でビューポート全体を覆う方式だと、
   TabBar等の実寸をピクセル計算でオフセットする必要がありモード（PC/モバイル/panel-bottom）
   ごとにズレやすかったため、position:absolute + inset:0 で親エリアにそのまま追従させる。 */
.modal-overlay {
  position: absolute;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 20;
  padding: 0;
}

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

/* モバイルはヘッダーが下部（ボトムシート風）に来るため、閉じる操作が
   ハンバーガー/Esc/バックドロップタップしか無いと分かりにくい。右下に
   独立した閉じるボタンを浮かせて出す。 */
.modal-close-fab {
  position: absolute;
  right: 16px;
  bottom: calc(env(safe-area-inset-bottom) + 16px);
  width: 44px;
  height: 44px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 1;
}

:deep(.settings-panel-header) {
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: calc(env(safe-area-inset-bottom) + 8px);
  order: 1;
}

:deep(.settings-panel-body) {
  order: 0;
}

/* PC幅ではモバイルのボトムシート風（ヘッダー下部）をやめ、ヘッダーを上に固定する。
   このコンポーネント自体はモバイル専用だが、念のためPC幅でオーバーレイが
   出てしまった場合でも崩れないよう残しておく。 */
@media (min-width: 769px) {
  :deep(.settings-panel-header) {
    border-bottom: 1px solid var(--border);
    border-top: none;
    padding-bottom: 0;
    order: 0;
  }

  :deep(.settings-panel-body) {
    order: 1;
  }
}
</style>
