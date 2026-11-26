<template>
  <ModalShell
    :is-open="isOpen"
    overlay-class="terminal-settings-modal"
    :title="modalTitle"
    :branch="modalBranch"
    :can-back="canNavigateBack"
    close-label="Close settings"
    @back="onBack"
    @close="close"
    @overlay="close"
    @escape="close"
  >
    <component :is="VIEWS[currentView ?? '']" v-if="currentView && VIEWS[currentView]" />
  </ModalShell>
</template>

<script setup lang="ts">
import { useSettingsNav } from "../composables/useSettingsNav.ts";
import { provideModalView } from "../composables/useModalView.ts";
import ModalShell from "./ModalShell.vue";
import SettingsMenu from "./SettingsMenu.vue";
import ServerProcessesView from "./ServerProcessesView.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import AuthConfig from "./AuthConfig.vue";
import PairDeviceConfig from "./PairDeviceConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import DisplayConfig from "./DisplayConfig.vue";
import SendSnippet from "./SendSnippet.vue";
import SendHistory from "./SendHistory.vue";
import NotificationConfig from "./NotificationConfig.vue";
import CircleKeypadConfig from "./CircleKeypadConfig.vue";
import PreviewConfig from "./PreviewConfig.vue";

// 歯車ボタンから開くSettings系列の全面オーバーレイ。シェルはModalShell.vueに共通化済みで、ここはビュー列挙とuseSettingsNav.tsへの配線のみ。

const {
  isOpen, currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, onBack, closeNav,
} = useSettingsNav();

provideModalView({
  modalTitle, modalBranch, viewState: currentState,
  pushView, popView, updateViewState,
});

const VIEWS: Record<string, unknown> = {
  SettingsMenu,
  ServerProcesses: ServerProcessesView,
  TerminalConfig,
  EditorConfig,
  AuthConfig,
  PairDeviceConfig,
  ServerInfo,
  DisplayConfig,
  SendSnippet,
  SendHistory,
  NotificationConfig,
  CircleKeypadConfig,
  PreviewConfig,
};

function close() {
  closeNav();
}

defineExpose({ onBack });
</script>
