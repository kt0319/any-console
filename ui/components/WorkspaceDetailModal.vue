<template>
  <div
    v-if="isOpen"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @mousedown.self="onBack"
  >
    <div ref="modalEl" class="modal">
      <div class="settings-panel-header">
        <button type="button" class="modal-title-wrap" @click="onBack">
          <h3 class="modal-title">
            {{ modalTitle }}<template v-if="modalBranch"><span class="modal-title-sep"> / </span><span class="modal-title-branch" :data-tooltip="modalBranch">{{ modalBranch }}</span></template>
          </h3>
        </button>
        <!-- PC・モバイル共通：サイドバー/ハンバーガーとは別に、このオーバーレイ
             だけを閉じられるようにする（モバイルはハンバーガーでサイドバーと
             同時に閉じることもできるが、それとは別に単体で閉じる手段も出す）。 -->
        <button
          type="button"
          class="modal-close-btn"
          aria-label="Close workspace detail"
          data-tooltip="Close workspace detail"
          @click="close"
        >&times;</button>
      </div>
      <div class="settings-panel-body">
        <WorkspaceDetail :ref="setPaneRef" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, provide, watch } from "vue";
import { useModal } from "../composables/useModal.js";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import { useWorkspaceDetailNav } from "../composables/useWorkspaceDetailNav.js";
import WorkspaceDetail from "./WorkspaceDetail.vue";

// WorkspaceDetail（Files/Changes/History/Branches/Jobs/Stash）専用の全面
// オーバーレイ。Settingsのナビゲーション（useSettingsNav.js／SessionSidebar.vue
// /Modal.vue）とは完全に独立しており（useWorkspaceDetailNav.js）、開いても
// 裏のセッション一覧/設定側の表示は変化しない。PC・モバイル共通でこの
// コンポーネントが担当する（.content-area、TabBarの下＝ターミナル表示
// エリアと同じ場所に配置。PCはサイドバー分.content-areaが右へ縮んでいる
// ため、サイドバーには被さらずターミナル部分だけに重なる）。
//
// pushView/popViewだけは例外的にuseSettingsNav.jsの実体をprovideする
// （WorkspaceJobsPane.vueの「Add Job」からJobConfig（Settings側の画面）を
// 開く導線があるため）。

const modal = useModal();
const { pushView, popView } = useSettingsNav();
const {
  isOpen, viewState, modalTitle, modalBranch,
  onBack, close, setPaneRef, updateViewState,
} = useWorkspaceDetailNav();

provide("modalTitle", modalTitle);
provide("modalBranch", modalBranch);
provide("viewState", viewState);
provide("pushView", pushView);
provide("popView", popView);
provide("updateViewState", updateViewState);

const modalEl = ref(null);

watch(
  isOpen,
  (shouldShow) => {
    if (shouldShow) {
      modal.open(() => modalEl.value, onBack);
    } else if (modal.visible.value) {
      modal.close();
    }
  },
);
</script>

<style scoped>
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

/* Modal.vue（モバイルの設定オーバーレイ）と同じボトムシート風にする。
   モバイルはタイトルを下部に表示し、PC幅では通常通り上部に戻す。 */
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

.modal-title-wrap {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  justify-content: flex-start;
  cursor: pointer;
}

.modal-title-wrap .modal-title {
  font-size: 15px;
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  text-align: left;
}

.modal-title-sep {
  color: var(--text-muted);
}

.modal-title-branch {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 400;
}

.modal-close-btn {
  width: 36px;
  height: 36px;
  margin-left: auto;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .modal-close-btn:hover {
    color: var(--text-primary);
  }
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

/* GitHistory/GitStash/GitChangeBranch/WorkspaceJobsPane等、多数のペインが
   共通で使う「スクロール本体」の見た目の契約。SettingsPanel.vueの同名ルール
   と同じ内容（WorkspaceDetailはSettingsのスタックから独立したため、ここにも
   必要）。無いとhistoryListEl等のスクロールが効かなくなる。 */
:deep(.modal-scroll-body) {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 0 8px;
}
</style>
