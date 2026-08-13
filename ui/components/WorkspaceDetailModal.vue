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
        <WorkspaceDetail :key="activeTabId" :ref="setPaneRef" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, provide, watch } from "vue";
import { useModal } from "../composables/useModal.ts";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
import { useWorkspaceDetailNav } from "../composables/useWorkspaceDetailNav.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import WorkspaceDetail from "./WorkspaceDetail.vue";

// WorkspaceDetail（Files/Changes/History/Branches/Jobs/Stash）専用の全面
// オーバーレイ。セッション一覧/Open Session/Settingsのナビゲーションとは
// 完全に独立しており（useWorkspaceDetailNav.js）、開いても裏のそれらの
// 表示は変化しない。PC・モバイル共通でこのコンポーネントが担当する
// （.content-area、TabBarの下＝ターミナル表示エリアと同じ場所に配置。
// PCはサイドバー分.content-areaが右へ縮んでいるため、サイドバーには
// 被さらずターミナル部分だけに重なる）。
//
// pushView/popViewだけは例外的にuseSessionOpenNav.jsの実体をprovideする
// （WorkspaceJobsPane.vueの「Add Job」からJobConfig（Open Session側の画面）を
// 開く導線があるため）。

const modal = useModal();
const { pushView, popView } = useSessionOpenNav();
const {
  isOpen, viewState, modalTitle, modalBranch,
  onBack, close, setPaneRef, updateViewState,
} = useWorkspaceDetailNav();
const terminalStore = useTerminalStore();
// タブ切替のたびに<WorkspaceDetail>を再マウントし、useWorkspaceDetailNav.js
// がタブごとに保持しているisOpen/detail(pane)を確実に反映させる
// （WorkspaceDetail.vue自体はopen()をonMounted時にしか呼ばないため）。
const activeTabId = computed(() => terminalStore.activeTabId);

provide("modalTitle", modalTitle);
provide("modalBranch", modalBranch);
provide("viewState", viewState);
provide("pushView", pushView);
provide("popView", popView);
provide("updateViewState", updateViewState);
// DispatchRunViewがRun成功後にこのオーバーレイごと閉じるために使う
// （WorkspaceDetail.vue参照）。
provide("closeWorkspaceDetail", close);

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
/* .modal-overlay / .modal-title系 / .modal-close-btn の共通の見た目は
   ui/styles/modal-shell.css（グローバル）で Modal.vue / SettingsPanel.vue と
   共用する。ここには固有の差分だけを置く。 */
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

/* このタイトルは常にタップで閉じる（戻る）ボタンとして機能する。 */
.modal-title-wrap {
  cursor: pointer;
}

.modal-close-btn {
  margin-left: auto;
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

/* 各ペインが使う .modal-scroll-body（スクロール本体）の契約は
   ui/styles/modal-shell.css の .settings-panel-body .modal-scroll-body 参照。 */
</style>
