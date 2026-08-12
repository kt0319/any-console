<template>
  <div class="modal-scroll-body session-list-view">
    <div class="session-list-scroll">
      <ul v-if="items.length > 0" class="session-sidebar-list">
        <SessionSidebarRow
          v-for="item in items"
          :key="item.id"
          :item="item"
          :active="item.id === activeTabId"
          :prs-by-workspace="prsByWorkspace"
          :runs-by-workspace="runsByWorkspace"
          @select="onSelect(item)"
          @pill-open="onPillOpen(item, $event)"
          @close-tab="onCloseTab(item)"
        />
      </ul>
      <div v-else class="session-sidebar-empty">No sessions</div>

      <!-- タブがまだ無いワークスペースの承認待ちdispatch。通常のセッション行と
           同じ見た目（SessionRowContent + InfoPillRow）で出す。見出しは出さず、
           行のPendingバッジとワークスペース名の非アクティブ色だけで区別する。 -->
      <template v-if="pendingDispatchWorkspaces.length > 0">
        <ul class="session-sidebar-list session-sidebar-list-pending">
        <li v-for="p in pendingDispatchWorkspaces" :key="p.workspace" class="session-sidebar-li">
          <button type="button" class="session-sidebar-item hover-bg" @click="onOpenPendingDispatch(p)">
            <SessionRowContent :item="p" dim />
          </button>
          <span class="session-sidebar-pills-row">
            <InfoPillRow
              class="session-sidebar-pills"
              :tab="{ workspace: p.workspace, wsIcon: p.wsIcon }"
              :max-width="PILL_MAX_WIDTH_UNLIMITED_PX"
              :is-git-repo="p.isGitRepo"
              :is-dirty="p.dirty"
              :ahead="p.ahead"
              :behind="p.behind"
              :has-pr="p.hasPr"
              :has-action="p.hasAction"
              :has-dev-server="p.hasDevServer"
              :dispatch-count="p.dispatchCount"
              :action-status-class="p.actionStatusClass"
              :action-status-icon="p.actionStatusIcon"
              :tooltips="p.tooltips"
              @open="onPendingPillOpen(p, $event)"
            />
          </span>
        </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { sessionSidebarItems, pendingDispatchSidebarItems } from "../utils/session-sidebar.js";
import { useGithubPolling } from "../composables/useGithubPolling.js";
import { usePreviewPorts } from "../composables/usePreviewPorts.js";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import { useInfoPillActions } from "../composables/useInfoPillActions.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import InfoPillRow from "./InfoPillRow.vue";
import SessionRowContent from "./SessionRowContent.vue";
import SessionSidebarRow from "./SessionSidebarRow.vue";
import { emit } from "../app-bridge.js";
import { PILL_MAX_WIDTH_UNLIMITED_PX } from "../utils/constants.js";

// セッション一覧オーバーレイ（SessionListPanel.vue）の中身。開いているタブ
// ごとにワークスペース名・ブランチ・変更サマリ・エージェント状態・
// Info Pillsを一覧表示する。行の組み立ては ui/utils/session-sidebar.js
// （純粋関数）。
//
// Open Session/Settingsはタブバーの「+」/歯車ボタン（useSessionOpenNav.js/
// useSettingsNav.js）から独立して開くため、このビューからは直接遷移しない。

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const { confirm } = useConfirm();

// 各行のInfo Pills（TerminalPaneと同じピル群）用データ源。取得・重複排除・
// 参照カウント式ポーリングの実装は各composable側（TerminalPaneと共有）。
// PR/Actionsのポーリングは必ずペアで開始・停止するためuseGithubPollingに集約。
const { prsByWorkspace, runsByWorkspace, startGithubPolling, stopGithubPolling } = useGithubPolling();
const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling } = usePreviewPorts();
const { queue: dispatchQueue } = useDispatchConfirm();

// 開いているタブが無いワークスペースでも承認待ちのdispatchを見逃さないよう、
// タブ一覧の下に別枠で出す（タブが既にあるワークスペースはInfoPillRowの
// dispatchピルで足りるため対象外）。通常のセッション行と同じ情報
// （Branch/Changes/PR/Actions/DevServer/Dispatchの各ピル）で出すため、
// 組み立てロジックはsessionSidebarItemsと共有する（session-sidebar.js）。
const pendingDispatchWorkspaces = computed(() => {
  const openTabWorkspaces = new Set(terminalStore.openTabs.map((t) => t.workspace).filter(Boolean));
  return pendingDispatchSidebarItems(workspaceStore.allWorkspaces, openTabWorkspaces, {
    prsByWorkspace: prsByWorkspace.value,
    runsByWorkspace: runsByWorkspace.value,
    previewPorts: previewPorts.value,
    dispatchQueue: dispatchQueue.value,
    hostname: location.hostname,
  });
});

function onOpenPendingDispatch(p) {
  workspaceStore.selectedWorkspace = p.workspace;
  // 承認待ちが1件だけなら一覧を経由せずRun Dispatchへ直接飛ぶ。
  const dispatchItemId = p.dispatchItems.length === 1 ? p.dispatchItems[0].id : undefined;
  emit("git:openFileModal", { pane: "dispatch", dispatchItemId });
}

// pendingワークスペース行はBranch/PR/Actions/DevServer等のピルも通常の行と
// 同じく出すため、それぞれ対応するペインへ遷移できるよう
// useInfoPillActionsを共有する（タブが無いのでitem.tab固定でopenPaneのみ使う）。
// dispatchキーだけはonOpenPendingDispatchと同じ1件ショートカットを使う。
function onPendingPillOpen(p, key) {
  if (key === "dispatch") { onOpenPendingDispatch(p); return; }
  workspaceStore.selectedWorkspace = p.workspace;
  openPaneFor({ workspace: p.workspace }, p, key);
}

// useInfoPillActions を都度組み立てて対応ペインを開く（通常行 / pending行 共通）。
function openPaneFor(tab, source, key) {
  const { openPane } = useInfoPillActions({
    tab: ref(tab),
    isGitRepo: ref(source.isGitRepo),
    devServerEntry: ref(source.devServerEntry),
  });
  openPane(key);
}

const activeTabId = computed(() => terminalStore.activeTabId);

const items = computed(() => {
  // tab は markRaw のため tab.workspace 単体の変更は追跡されない。
  // tabWorkspaceVersion を読んで依存に含める（TabItem と同じ理由）。
  terminalStore.tabWorkspaceVersion;
  return sessionSidebarItems(terminalStore.openTabs, workspaceStore.allWorkspaces, {
    tabFlags: terminalStore.tabFlags,
    agentStates: terminalStore.agentStates,
    doneSessions: terminalStore.doneSessions,
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
  // openPaneが積むビュー（WorkspaceDetail等）は同じ共有スタックの続きとして
  // 表示されるため、ここでサイドバー自体を閉じない（閉じると開いた直後の
  // ビューごと隠れてしまう）。
  openPaneFor(item.tab, item, key);
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
    if (!keySet.has(old)) stopGithubPolling(old);
  }
  for (const key of keys) {
    if (!activeGithubKeys.includes(key)) startGithubPolling(key);
  }
  activeGithubKeys = keys;
}, { immediate: true });

startPreviewPolling();

onBeforeUnmount(() => {
  for (const key of activeGithubKeys) stopGithubPolling(key);
  stopPreviewPolling();
});
</script>

<style scoped>
/* modal-shell.css の .modal-scroll-body は「本文全体がそのまま
   1つスクロールする」前提のスタイル（overflow-y:auto）だが、このビューは
   下部の.session-list-menuを固定したまま、その上の.session-list-scrollだけを
   スクロールさせたいため、自身はスクロールさせない（overflow-y:hidden）。
   詳細度で負けないよう!importantで上書きする。 */
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

/* pending行の一覧は見出しを出さず、開いているセッション一覧との罫線だけで
   区切る。 */
.session-sidebar-list-pending {
  border-top: 1px solid var(--border);
}

/* .session-sidebar-li/.session-sidebar-item/.session-sidebar-pills-row の
   共通見た目（罫線・ホバー・active色・working/blocked/phrase-notify演出）は
   このビュー自身のpending dispatch行とSessionSidebarRow.vueの両方が同じ
   クラス名を使うため、scopedを跨いで共有できるグローバルCSS
   （ui/styles/session-sidebar.css）に集約する。 */


.session-sidebar-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
