<template>
  <ModalShell
    :is-open="isOpen"
    overlay-class="session-open-modal"
    :title="modalTitle"
    :branch="modalBranch"
    :can-back="canNavigateBack"
    close-label="Close open session"
    @back="onBack"
    @close="close"
    @overlay="close"
    @escape="close"
  >
    <component :is="VIEWS[currentView ?? '']" v-if="currentView && VIEWS[currentView]" />
  </ModalShell>
</template>

<script setup lang="ts">
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
import { provideModalView } from "../composables/useModalView.ts";
import ModalShell from "./ModalShell.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAddView from "./WorkspaceAddView.vue";
import WorkspaceEditPane from "./WorkspaceEditPane.vue";
import JobConfig from "./JobConfig.vue";
import IconPicker from "./IconPicker.vue";

// タブバーの「+」ボタンから開くOpen Session系列（WorkspaceOpen/WorkspaceAdd/
// WorkspaceEdit/JobConfig/IconPicker）専用の全面オーバーレイ。
// シェル（テンプレート・フォーカストラップ・共通CSS）はModalShell.vueに
// 共通化されており、ここは表示するビューの列挙とuseSessionOpenNav.ts
// （Settings/セッション一覧とは完全に独立したビュースタック）への配線だけを持つ。

const {
  isOpen, currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, onBack, closeNav,
} = useSessionOpenNav();

provideModalView({
  modalTitle, modalBranch, viewState: currentState,
  pushView, popView, updateViewState,
});

// ビュー名 → コンポーネントの対応（ビュー追加はここに1行足すだけ）。
const VIEWS: Record<string, unknown> = {
  WorkspaceOpen,
  WorkspaceAdd: WorkspaceAddView,
  WorkspaceEdit: WorkspaceEditPane,
  JobConfig,
  IconPicker,
};

function close() {
  closeNav();
}

defineExpose({ onBack });
</script>
