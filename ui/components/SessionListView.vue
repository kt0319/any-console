<template>
  <div class="modal-scroll-body session-list-view">
    <div class="session-list-scroll">
      <ul v-if="items.length > 0" class="session-sidebar-list">
        <li v-for="item in items" :key="item.id" class="session-sidebar-li">
          <button
            type="button"
            class="session-sidebar-item"
            :class="{
              active: item.id === activeTabId,
              'session-working': item.agent?.className === 'agent-state-working',
              'session-blocked': item.agent?.className === 'agent-state-blocked',
              'session-phrase-notify': item.phraseNotify,
            }"
            :aria-current="item.id === activeTabId ? 'true' : undefined"
            @click="onSelect(item)"
          >
            <SessionRowContent :item="item" />
          </button>
          <span
            class="session-sidebar-pills-row"
            :class="{
              active: item.id === activeTabId,
              'session-working': item.agent?.className === 'agent-state-working',
              'session-blocked': item.agent?.className === 'agent-state-blocked',
              'session-phrase-notify': item.phraseNotify,
            }"
          >
            <InfoPillRow
              class="session-sidebar-pills"
              :tab="item.tab"
              :max-width="9999"
              :is-git-repo="item.isGitRepo"
              :is-dirty="item.dirty"
              :ahead="item.ahead"
              :behind="item.behind"
              :has-pr="item.hasPr"
              :has-action="item.hasAction"
              :has-dev-server="item.hasDevServer"
              :dispatch-count="item.dispatchCount"
              :action-status-class="item.actionStatusClass"
              :action-status-icon="item.actionStatusIcon"
              :tooltips="item.tooltips"
              @open="onPillOpen(item, $event)"
            />
            <button
              type="button"
              class="pill-close-btn pill-tab-close-btn"
              aria-label="Close tab"
              data-tooltip="Close tab"
              @click.stop="onCloseTab(item)"
            ><span class="mdi mdi-close"></span></button>
          </span>
        </li>
      </ul>
      <div v-else class="session-sidebar-empty">No sessions</div>
    </div>

    <div class="session-list-menu">
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceOpen')">
        <span class="mdi mdi-folder-plus-outline"></span> Open
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('SessionDispatches')">
        <span class="mdi mdi-tray-full"></span> Dispatches
        <span v-if="dispatchQueue.length" class="settings-menu-version">{{ dispatchQueue.length }}</span>
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('SessionPreview')">
        <span class="mdi mdi-server"></span> Server
        <span v-if="previewPortCount" class="settings-menu-version">{{ previewPortCount }}</span>
      </button>
      <button type="button" class="settings-menu-item" @click="pushView('ModalMenu')">
        <span class="mdi mdi-cog"></span> Settings
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount, inject } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { sessionSidebarItems } from "../utils/session-sidebar.js";
import { useWorkspacePRs } from "../composables/useWorkspacePRs.js";
import { useWorkspaceActions } from "../composables/useWorkspaceActions.js";
import { usePreviewPorts } from "../composables/usePreviewPorts.js";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import { useInfoPillActions } from "../composables/useInfoPillActions.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import InfoPillRow from "./InfoPillRow.vue";
import SessionRowContent from "./SessionRowContent.vue";
import { emit } from "../app-bridge.js";

// 統合ナビゲーション（useSettingsNav.js）の一番手前（ルート）のビュー。
// 開いているタブごとにワークスペース名・ブランチ・変更サマリ・エージェント
// 状態・Info Pillsを一覧表示する。
// 行の組み立ては ui/utils/session-sidebar.js（純粋関数）。
//
// Open/Dispatches/Settingsへは下部のメニュー（本物のpushView遷移）から進む。
// タブ帯としてSettingsPanel.vue側に常設表示していた時期もあったが、Sessions
// ページを離れたらメニューごと消えてよいという方針になったため、埋め込み式の
// メニューに戻した（メニュー自体はこのビューがマウントされている間だけ存在する）。

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Sessions";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const { confirm } = useConfirm();

// 各行のInfo Pills（TerminalPaneと同じピル群）用データ源。取得・重複排除・
// 参照カウント式ポーリングの実装は各composable側（TerminalPaneと共有）。
const { prsByWorkspace, fetchPRs, startPolling: startPRsPolling, stopPolling: stopPRsPolling } = useWorkspacePRs();
const { runsByWorkspace, fetchRuns, startPolling: startActionsPolling, stopPolling: stopActionsPolling } = useWorkspaceActions();
const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling } = usePreviewPorts();
const { queue: dispatchQueue } = useDispatchConfirm();

const activeTabId = computed(() => terminalStore.activeTabId);

// Serverメニュー項目のバッジ件数（旧SessionPreviewTab.vue/ModalMenu.vueが
// 持っていた「自分自身は除く」ロジックと同じ）。
const previewPortCount = computed(() => previewPorts.value.filter((p) => !p.is_self).length);

const items = computed(() => {
  // tab は markRaw のため tab.workspace 単体の変更は追跡されない。
  // tabWorkspaceVersion を読んで依存に含める（TabItem と同じ理由）。
  terminalStore.tabWorkspaceVersion;
  return sessionSidebarItems(terminalStore.openTabs, workspaceStore.allWorkspaces, {
    tabFlags: terminalStore.tabFlags,
    agentStates: terminalStore.agentStates,
    phraseNotifySessions: terminalStore.phraseNotifySessions,
    prsByWorkspace: prsByWorkspace.value,
    runsByWorkspace: runsByWorkspace.value,
    previewPorts: previewPorts.value,
    dispatchQueue: dispatchQueue.value,
    hostname: location.hostname,
  });
});

function onSelect(item) {
  if (item.id !== terminalStore.activeTabId) {
    // モバイルはタッチ操作前提のため、ソフトキーボードの誤起動を避けて skipFocus。
    emit("tab:select", { tab: item.tab, skipFocus: layoutStore.isPanelBottom });
  }
  // タブ切替えではサイドバー/オーバーレイを閉じない（モバイルでも同様）。
  // 閉じるのはハンバーガー/閉じるボタン・Escでの明示操作のみにする。
}

// ピルタップ：そのタブへ切替えてから対応ペインを開く（TerminalPaneの
// ピルと同じ遷移をuseInfoPillActionsで再利用する）。
function onPillOpen(item, key) {
  if (item.id !== terminalStore.activeTabId) {
    emit("tab:select", { tab: item.tab, skipFocus: layoutStore.isPanelBottom });
  }
  const { openPane } = useInfoPillActions({
    tab: ref(item.tab),
    isGitRepo: ref(item.isGitRepo),
    devServerEntry: ref(item.devServerEntry),
    tabDispatchItems: ref(item.dispatchItems),
  });
  // openPaneが積むビュー（WorkspaceDetail等）は同じ共有スタックの続きとして
  // 表示されるため、ここでサイドバー自体を閉じない（閉じると開いた直後の
  // ビューごと隠れてしまう）。
  openPane(key);
}

// タブを閉じる（破壊的操作のため、TerminalPaneと同じ確認ダイアログを通す）。
async function onCloseTab(item) {
  const result = await confirmCloseTab(confirm, item.tab);
  if (result === true) emit("tab:close", { tab: item.tab });
}

// このビューはSettingsPanel.vueにより「currentView==='SessionList'」の間
// だけマウントされる（他の設定画面を見ている間はアンマウントされる）ため、
// ポーリングはこのコンポーネント自身のマウント/アンマウントに素直に紐付く。
// PR/Actionsはgithub連携のあるgitワークスペースだけ、開いているタブの
// 集合が変わるたびに増減分だけ開始/停止する（TerminalPaneの同種ロジック
// を複数ワークスペース分にまとめたもの）。
const githubWorkspaceKeys = computed(() => {
  const keys = new Set();
  for (const tab of terminalStore.openTabs) {
    if (!tab.workspace) continue;
    const ws = workspaceStore.allWorkspaces.find((w) => w.name === tab.workspace);
    if (ws?.is_git_repo && ws?.github_url) keys.add(tab.workspace);
  }
  return [...keys];
});

let activeGithubKeys = /** @type {string[]} */ ([]);
watch(githubWorkspaceKeys, (keys) => {
  const keySet = new Set(keys);
  for (const old of activeGithubKeys) {
    if (!keySet.has(old)) {
      stopPRsPolling(old);
      stopActionsPolling(old);
    }
  }
  for (const key of keys) {
    if (!activeGithubKeys.includes(key)) {
      fetchPRs(key);
      fetchRuns(key);
      startPRsPolling(key);
      startActionsPolling(key);
    }
  }
  activeGithubKeys = keys;
}, { immediate: true });

startPreviewPolling();

onBeforeUnmount(() => {
  for (const key of activeGithubKeys) {
    stopPRsPolling(key);
    stopActionsPolling(key);
  }
  stopPreviewPolling();
});
</script>

<style scoped>
/* SettingsPanel.vue の :deep(.modal-scroll-body) は「本文全体がそのまま
   1つスクロールする」前提のスタイル（overflow-y:auto）だが、このビューは
   下部の.session-list-menuを固定したまま、その上の.session-list-scrollだけを
   スクロールさせたいため、自身はスクロールさせない（overflow-y:hidden）。
   :deep()の詳細度が上回るため!importantで上書きする。 */
.session-list-view {
  overflow-y: hidden !important;
}

.session-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.session-sidebar-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

/* セッション（タブ）ごとに罫線で区切る。 */
.session-sidebar-li {
  border-bottom: 1px solid var(--border);
}

.session-sidebar-li:last-child {
  border-bottom: none;
}

/* ピル行 + 閉じるボタンのコンテナ。activeタブの背景・左ボーダーは
   .session-sidebar-item.active と揃え、行全体が一体に見えるようにする
   （ボタン部分だけがアクティブ色になっていると分断して見えるため）。
   非activeの時は.session-sidebar-item側の既定（transparent、hover/active時のみ
   var(--bg-tertiary)）と揃え透明にする（常時色を敷くと、上の本体行との間に
   境目が見えてしまうため）。ピル自体（.pill-chip）は個別に地色を持つ。 */
.session-sidebar-pills-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px 8px 12px;
  border-left: 3px solid transparent;
  background: transparent;
}

.session-sidebar-pills-row.active {
  background: rgba(130, 170, 255, 0.12);
  border-left-color: var(--accent);
}

/* TerminalPaneのピル行と同じ見た目（ui/styles/info-pills.css）を土台に、
   サイドバー内では行の右端に寄せる。ピル自体の背景（.pill-chip既定は
   ターミナル背景越しに見える前提の半透明ダーク）はサイドバーの地色
   （--bg-secondary）に対して浮いて見えるため、サイドバー用に上書きする。 */
.session-sidebar-pills {
  display: flex;
  flex: 1;
  justify-content: flex-end;
  min-width: 0;
}

/* .pill-trailingは既定でflex:1 1 0%（親の残り幅いっぱいに広がる）ため、
   このコンテナのjustify-content:flex-endが効くよう中身サイズに縮める。 */
.session-sidebar-pills :deep(.pill-trailing) {
  flex: 0 1 auto;
}

.session-sidebar-pills :deep(.pill-chip) {
  background: var(--bg-tertiary);
  border-color: var(--border);
}

.session-sidebar-item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 8px 12px;
  border: none;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}

.session-sidebar-item:active {
  background: var(--bg-tertiary);
}

@media (hover: hover) and (pointer: fine) {
  .session-sidebar-item:hover {
    background: var(--bg-tertiary);
  }

  .session-sidebar-item.active:hover {
    background: rgba(130, 170, 255, 0.12);
  }
}

.session-sidebar-item.active {
  color: var(--text-primary);
  background: rgba(130, 170, 255, 0.12);
  border-left-color: var(--accent);
}

/* TabItem.vueと同じ演出（tab-working-pulse/tab-notify-blink）を行にも
   適用する。アクティブ行は既に強調色がついているため対象外にする。
   ピル行（.session-sidebar-pills-row）も同じ行の一部として同期して演出させる。 */
.session-sidebar-item.session-working:not(.active),
.session-sidebar-pills-row.session-working:not(.active) {
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    transparent 10%,
    rgba(130, 170, 255, 0.2) 50%,
    transparent 90%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: working-pulse 2s linear infinite;
}


.session-sidebar-item.session-phrase-notify:not(.active),
.session-sidebar-item.session-blocked:not(.active),
.session-sidebar-pills-row.session-phrase-notify:not(.active),
.session-sidebar-pills-row.session-blocked:not(.active) {
  background-image: none;
  animation: notify-blink 1.2s ease-in-out infinite;
}


.session-sidebar-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: var(--text-muted);
}

/* Open/Dispatches/Settingsへの入口。一覧の下に固定表示するメニュー
   （ModalMenu.vueの.settings-menu-itemと同じ見た目に揃える。scopedのため
   クラス名は同じでも競合しない）。 */
.session-list-menu {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

.settings-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  text-align: left;
  font-size: 14px;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.session-list-menu .settings-menu-item:last-child {
  border-bottom: none;
}

@media (hover: hover) and (pointer: fine) {
  .settings-menu-item:hover {
    background: var(--bg-tertiary);
  }
}

.settings-menu-item:active {
  background: var(--bg-tertiary);
}

.settings-menu-version {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

</style>
