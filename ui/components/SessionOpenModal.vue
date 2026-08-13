<template>
  <ModalShell
    :is-open="isOpen"
    overlay-class="session-open-modal"
    :title="modalTitle"
    :branch="modalBranch"
    :can-back="canNavigateBack"
    show-back-arrow
    close-label="Close open session"
    @back="onBack"
    @close="close"
    @overlay="close"
    @escape="close"
  >
    <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" />
    <WorkspaceAddView v-if="currentView === 'WorkspaceAdd'" />
    <WorkspaceEditPane v-if="currentView === 'WorkspaceEdit'" />
    <JobConfig v-if="currentView === 'JobConfig'" />
    <IconPicker v-if="currentView === 'IconPicker'" />
  </ModalShell>
</template>

<script setup lang="ts">
import { provide } from "vue";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
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

provide("modalTitle", modalTitle);
provide("modalBranch", modalBranch);
provide("viewState", currentState);
provide("pushView", pushView);
provide("popView", popView);
provide("updateViewState", updateViewState);

function close() {
  closeNav();
}

defineExpose({ onBack });
</script>
