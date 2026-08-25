<template>
  <ModalShell
    :is-open="isOpen"
    :title="modalTitle"
    :branch="modalBranch"
    can-back
    :show-back-arrow="false"
    close-label="Close workspace detail"
    @back="onBack"
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

// WorkspaceDetail（Files/Changes/History/Branches/Jobs/Stash）専用の全面
// オーバーレイ。セッション一覧/Open Session/Settingsのナビゲーションとは
// 完全に独立しており（useWorkspaceDetailNav.ts）、開いても裏のそれらの
// 表示は変化しない。PC・モバイル共通でこのコンポーネントが担当する
// （.content-area、TabBarの下＝ターミナル表示エリアと同じ場所に配置。
// PCはサイドバー分.content-areaが右へ縮んでいるため、サイドバーには
// 被さらずターミナル部分だけに重なる）。
// シェル（テンプレート・フォーカストラップ・共通CSS）はModalShell.vueに共通化。
// タイトルは常にタップで閉じる（戻る）ボタンとして機能する（←アイコンは
// 出さない従来の見た目のまま）。
//
// pushView/popViewだけは例外的にuseSessionOpenNav.tsの実体をprovideする
// （WorkspaceJobsPane.vueの「Add Job」からJobConfig（Open Session側の画面）を
// 開く導線があるため）。

const { pushView, popView } = useSessionOpenNav();
const {
  isOpen, viewState, modalTitle, modalBranch,
  onBack, close, setPaneRef, updateViewState,
} = useWorkspaceDetailNav();
const terminalStore = useTerminalStore();
// タブ切替のたびに<WorkspaceDetail>を再マウントし、useWorkspaceDetailNav.ts
// がタブごとに保持しているisOpen/detail(pane)を確実に反映させる
// （WorkspaceDetail.vue自体はopen()をonMounted時にしか呼ばないため）。
// null は「アクティブタブなし」。:key に渡すため number として扱う
// （実行時の値・挙動は不変）。
const activeTabId = computed(() => terminalStore.activeTabId as number);

provideModalView({ modalTitle, modalBranch, viewState, pushView, popView, updateViewState });
// DispatchRunViewがRun成功後にこのオーバーレイごと閉じるために使う
// （WorkspaceDetail.vue参照）。
provide("closeWorkspaceDetail", close);
</script>
