<template>
  <div class="settings-panel">
    <div class="settings-panel-header">
      <button
        type="button"
        class="modal-title-wrap"
        :class="{ 'is-clickable': canNavigateBack, 'no-back': !canNavigateBack }"
        :tabindex="canNavigateBack ? 0 : -1"
        :aria-disabled="!canNavigateBack ? 'true' : 'false'"
        @click="canNavigateBack && onBack()"
      >
        <h3 class="modal-title">
          <span v-if="canNavigateBack" class="mdi mdi-arrow-left modal-title-back-icon" aria-hidden="true"></span>
          <span class="modal-title-text">{{ modalTitle }}<template v-if="modalBranch"><span class="modal-title-sep"> / </span><span class="modal-title-branch" :data-tooltip="modalBranch">{{ modalBranch }}</span></template></span>
        </h3>
      </button>
    </div>
    <div class="settings-panel-content">
      <div class="session-tabs">
        <button
          v-for="tab in sessionTabs"
          :key="tab.key"
          type="button"
          class="session-tab"
          :class="{ active: activeTab === tab.key, 'tab-underline-active': activeTab === tab.key }"
          :aria-label="tab.count ? `${tab.label} (${tab.count})` : tab.label"
          :data-tooltip="activeTab === tab.key ? null : tab.label"
          @click="selectTab(tab.key)"
        >
          <span class="mdi" :class="tab.icon" aria-hidden="true"></span>
          <span class="session-tab-label" :class="{ 'session-tab-label-active': activeTab === tab.key }" aria-hidden="true">{{ tab.label }}<span v-if="tab.count"> ({{ tab.count }})</span></span>
        </button>
      </div>
      <div class="settings-panel-body">
        <SessionListView v-if="currentView === 'SessionList'" />
        <SessionDispatchesTab v-if="currentView === 'SessionDispatches'" />
        <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" />
        <ModalMenu v-if="currentView === 'ModalMenu'" />
        <WorkspaceAddView v-if="currentView === 'WorkspaceAdd'" />
        <WorkspaceEditPane v-if="currentView === 'WorkspaceEdit'" />
        <JobConfig v-if="currentView === 'JobConfig'" />
        <DispatchRunView v-if="currentView === 'DispatchRunView'" />
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
        <IconPicker v-if="currentView === 'IconPicker'" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, provide } from "vue";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import SessionListView from "./SessionListView.vue";
import SessionDispatchesTab from "./SessionDispatchesTab.vue";
import ModalMenu from "./ModalMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAddView from "./WorkspaceAddView.vue";
import WorkspaceEditPane from "./WorkspaceEditPane.vue";
import JobConfig from "./JobConfig.vue";
import DispatchRunView from "./DispatchRunView.vue";
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
import IconPicker from "./IconPicker.vue";

// Modal.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使う設定画面の中身。ナビゲーション状態はuseSettingsNav.js
// （モジュールスコープの単一状態）を共有するため、表示場所が変わっても
// 同じビュースタックのまま続きから見える。WorkspaceDetailはuseWorkspaceDetailNav.js
// で完全に独立させているため、ここには含まれない（WorkspaceDetailModal.vue参照）。

const {
  viewStack, currentView, canNavigateBack,
  modalTitle, modalBranch, currentState,
  pushView, popView, updateViewState, openView, onBack,
} = useSettingsNav();

provide("modalTitle", modalTitle);
provide("modalBranch", modalBranch);
provide("viewState", currentState);
provide("pushView", pushView);
provide("popView", popView);
provide("updateViewState", updateViewState);

// Sessions/Dispatches/Open/Settingsの切替えタブ帯。以前は
// SessionListView.vue自身がactiveTabを持ち、Open/SettingsもWorkspaceOpen.vue/
// ModalMenu.vueを内部に埋め込んで表示していたが、その方式だと埋め込んだ
// 先（ModalMenu→TerminalConfig等）へさらに一段掘り下げるとcurrentViewが
// 変わりSessionListView自体がアンマウントされ、タブ帯ごと消えてしまう
// 問題があった。タブ帯をこのSettingsPanel.vue側の常設表示にし、Dispatches/
// Open/Settingsも他の設定画面と同じ「本物のcurrentView遷移」に
// 統一することで、どれだけ深く（ModalMenu→TerminalConfig→…）進んでも
// タブ帯は常に表示され続ける。
// アクティブなタブの判定はviewStackの2番目（stack[0]は常にSessionListが
// 不動のルート）を見る。3段目以降（例: ModalMenu→TerminalConfig）に進んでも
// 「どの枝から辿ってきたか」はstack[1]で分かるため、対応表に無い枝は
// すべてSettings扱いにする（ModalMenu配下の設定画面は数が多いため）。
const TAB_BRANCH_ROOTS = {
  SessionDispatches: "dispatches",
  WorkspaceOpen: "openWorkspace",
  WorkspaceAdd: "openWorkspace",
  WorkspaceEdit: "openWorkspace",
};

const activeTab = computed(() => {
  if (viewStack.value.length <= 1) return "sessions";
  return TAB_BRANCH_ROOTS[viewStack.value[1].view] || "settings";
});

const { queue: dispatchQueue } = useDispatchConfirm();

const sessionTabs = computed(() => [
  { key: "sessions", icon: "mdi-view-list-outline", label: "Sessions" },
  { key: "openWorkspace", icon: "mdi-folder-plus-outline", label: "Open" },
  { key: "dispatches", icon: "mdi-tray-full", label: "Dispatches", count: dispatchQueue.value.length },
  { key: "settings", icon: "mdi-cog", label: "Settings" },
]);

// タブクリックはそのタブの根本ビューへ飛ぶ（掘り下げた分の状態は破棄される。
// タブ切替え=そのセクションのトップへ戻る、という一般的な挙動）。
const TAB_OPEN_VIEW = {
  sessions: "SessionList",
  openWorkspace: "WorkspaceOpen",
  dispatches: "SessionDispatches",
  settings: "ModalMenu",
};

function selectTab(key) {
  openView([{ view: TAB_OPEN_VIEW[key], state: {} }]);
}

defineExpose({ onBack });
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.settings-panel-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
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

.modal-title-wrap.is-clickable {
  cursor: pointer;
}

.modal-title-back-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  color: inherit;
}

.modal-title-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-title-sep {
  color: var(--text-muted);
}

.modal-title-branch {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 400;
}

/* Sessions/Dispatches/Open/Settingsの切替え帯（.session-tabs）と
   本文（.settings-panel-body）をまとめる、DOM順を反転できる内側コンテナ。
   ヘッダー（.settings-panel-header）は常に画面上部固定のため反転対象に
   含めず、この内側だけをWorkspaceDetail.vueの.workspace-detailと同じ
   考え方でcolumn/column-reverse切替えする。 */
.settings-panel-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.settings-panel-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

:deep(.modal-scroll-body) {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 0 8px;
}

/* タブ帯本体。見た目・演出はWorkspaceDetail.vueの.workspace-tabs/.workspace-tabと
   揃える（アイコンのみ⇔選択中だけラベルが横に伸びて出現、下線は
   .tab-underline-active::after を共有）。 */
.session-tabs {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  gap: 4px;
  padding: 0 8px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  background: transparent;
  scrollbar-width: none;
  border-bottom: 1px solid var(--border);
}

.session-tabs::-webkit-scrollbar {
  display: none;
}

.session-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 18px;
  background: transparent;
  border: none;
  border-radius: 0;
  color: var(--text-muted);
  font-size: 15px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  opacity: 0.6;
}

.session-tab .mdi {
  font-size: 20px;
  line-height: 1;
}

.session-tab.active {
  color: var(--text-primary);
  background: rgba(130, 170, 255, 0.12);
  opacity: 1;
}

.session-tab-label {
  line-height: 1;
  max-width: 0;
  margin-left: -6px;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  transition: max-width 0.25s ease, opacity 0.2s ease, margin-left 0.25s ease;
}

.session-tab-label-active {
  max-width: 160px;
  margin-left: 0;
  opacity: 1;
}

/* モバイル（768px未満）はWorkspaceDetail.vueと同じ考え方で、タブ帯を
   画面下側（親指が届く位置）に寄せ、本文を上に出す。 */
@media (max-width: 767px) {
  .settings-panel-content {
    flex-direction: column-reverse;
  }

  .session-tabs {
    border-bottom: none;
    border-top: 1px solid var(--border);
  }

  .session-tab.tab-underline-active::after {
    top: 0;
    bottom: auto;
  }
}
</style>
