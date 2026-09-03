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
import CircleKeypadConfig from "./CircleKeypadConfig.vue";
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

provideModalView({
  modalTitle, modalBranch, viewState: currentState,
  pushView, popView, updateViewState,
});

// ビュー名 → コンポーネントの対応（ビュー追加はここに1行足すだけ）。
const VIEWS: Record<string, unknown> = {
  ModalMenu,
  SessionPreview: SessionPreviewTab,
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
  InfoPillConfig,
  ConfigFile,
};

function close() {
  closeNav();
}

defineExpose({ onBack });
</script>
