<template>
  <ModalShell
    :is-open="isOpen"
    overlay-class="terminal-settings-modal"
    :title="modalTitle"
    :branch="modalBranch"
    :can-back="canNavigateBack"
    show-back-arrow
    close-label="Close settings"
    @back="onBack"
    @close="close"
    @overlay="close"
    @escape="close"
  >
    <ModalMenu v-if="currentView === 'ModalMenu'" />
    <SessionPreviewTab v-if="currentView === 'SessionPreview'" />
    <TerminalConfig v-if="currentView === 'TerminalConfig'" />
    <EditorConfig v-if="currentView === 'EditorConfig'" />
    <AuthConfig v-if="currentView === 'AuthConfig'" />
    <PairDeviceConfig v-if="currentView === 'PairDeviceConfig'" />
    <ServerInfo v-if="currentView === 'ServerInfo'" />
    <DisplayConfig v-if="currentView === 'DisplayConfig'" />
    <SendSnippet v-if="currentView === 'SendSnippet'" />
    <SendHistory v-if="currentView === 'SendHistory'" />
    <NotificationConfig v-if="currentView === 'NotificationConfig'" />
    <CircleKeyPadConfig v-if="currentView === 'CircleKeyPadConfig'" />
    <InfoPillConfig v-if="currentView === 'InfoPillConfig'" />
    <ConfigFile v-if="currentView === 'ConfigFile'" />
  </ModalShell>
</template>

<script setup lang="ts">
import { provide } from "vue";
import { useSettingsNav } from "../composables/useSettingsNav.ts";
import ModalShell from "./ModalShell.vue";
import ModalMenu from "./ModalMenu.vue";
import SessionPreviewTab from "./SessionPreviewTab.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import AuthConfig from "./AuthConfig.vue";
import PairDeviceConfig from "./PairDeviceConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import DisplayConfig from "./DisplayConfig.vue";
import SendSnippet from "./SendSnippet.vue";
import SendHistory from "./SendHistory.vue";
import NotificationConfig from "./NotificationConfig.vue";
import CircleKeyPadConfig from "./CircleKeyPadConfig.vue";
import InfoPillConfig from "./InfoPillConfig.vue";
import ConfigFile from "./ConfigFile.vue";

// タブバーの歯車ボタンから開くSettings系列専用の全面オーバーレイ。
// シェル（テンプレート・フォーカストラップ・共通CSS）はModalShell.vueに
// 共通化されており、ここは表示するビューの列挙とuseSettingsNav.ts
// （Open Session/セッション一覧とは完全に独立したビュースタック）への
// 配線だけを持つ。

const {
  isOpen, currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, onBack, closeNav,
} = useSettingsNav();

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
