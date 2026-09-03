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

// WorkspaceDetail（Files/Changes/History/Branches/Jobs/Stash）専用の全面オーバーレイ。
// セッション一覧/Open Session/Settingsのナビゲーション（useWorkspaceDetailNav.ts）とは独立。
// シェル（テンプレート・フォーカストラップ・共通CSS）はModalShell.vueに共通化。

// pushView/popViewだけは例外的にuseSessionOpenNav.tsの実体をprovideする
// （WorkspaceJobsPane.vueの「Add Job」からJobConfig（Open Session側の画面）を開く導線があるため）。
const { pushView, popView } = useSessionOpenNav();
const {
  isOpen, viewState, modalTitle, modalBranch,
  onBack, close, setPaneRef, updateViewState,
} = useWorkspaceDetailNav();
const terminalStore = useTerminalStore();
// タブ切替のたびに<WorkspaceDetail>を再マウントし、useWorkspaceDetailNav.tsがタブごとに
// 保持しているisOpen/detail(pane)を確実に反映させる（WorkspaceDetail.vue自体はopen()を
// onMounted時にしか呼ばないため）。:key に渡すため number として扱う（値・挙動は不変）。
const activeTabId = computed(() => terminalStore.activeTabId as number);

provideModalView({ modalTitle, modalBranch, viewState, pushView, popView, updateViewState });
// DispatchRunViewがRun成功後にこのオーバーレイごと閉じるために使う
// （WorkspaceDetail.vue参照）。
provide("closeWorkspaceDetail", close);
</script>
