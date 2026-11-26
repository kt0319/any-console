<template>
  <ModalShell
    :is-open="isOpen"
    :title="modalTitle"
    :branch="modalBranch"
    close-label="Close workspace detail"
    @close="close"
    @overlay="onBack"
    @escape="onBack"
  >
    <WorkspaceDetail :key="activeTabId" :ref="setPaneRef" />
  </ModalShell>
</template>

<script setup lang="ts">
import { computed, provide } from "vue";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
import { useWorkspaceDetailNav } from "../composables/useWorkspaceDetailNav.ts";
import { provideModalView } from "../composables/useModalView.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import ModalShell from "./ModalShell.vue";
import WorkspaceDetail from "./WorkspaceDetail.vue";

// WorkspaceDetail 専用の全面オーバーレイ。セッション一覧 / Open Session / Settings のナビ（useWorkspaceDetailNav.ts）とは独立。
// シェルは ModalShell.vue に共通化。

// provideModalViewがpushView/popViewを必須とするため、useSessionOpenNav.tsの実体を渡す
// （詳細内のペインは現状どちらも呼ばない）。
const { pushView, popView } = useSessionOpenNav();
const {
  isOpen, viewState, modalTitle, modalBranch,
  onBack, close, setPaneRef, updateViewState,
} = useWorkspaceDetailNav();
const terminalStore = useTerminalStore();
// タブ切替のたびに <WorkspaceDetail> を再マウントし、タブごとの isOpen/detail(pane) を反映させる
// （WorkspaceDetail.vue は open() を onMounted 時にしか呼ばない）。
const activeTabId = computed(() => terminalStore.activeTabId as number);

provideModalView({ modalTitle, modalBranch, viewState, pushView, popView, updateViewState });
// DispatchRunView が Run 成功後にこのオーバーレイごと閉じるために使う
provide("closeWorkspaceDetail", close);
</script>
