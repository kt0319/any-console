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
      <div v-else-if="browserTabItems.length === 0" class="session-sidebar-empty">No sessions</div>

      <!-- ブラウザタブ（BrowserPane.vue、dev serverプレビュー）。tmuxセッションを
           持たないためInfoPill（Branch/Changes等）は無く、アイコン+ラベル+閉じる
           ボタンだけのシンプルな行にする。 -->
      <ul v-if="browserTabItems.length > 0" class="session-sidebar-list">
        <li
          v-for="bt in browserTabItems"
          :key="'browser-' + bt.tab.id"
          class="session-sidebar-li browser-tab-sidebar-li"
          :class="{ active: bt.isActive, 'session-working': bt.tab.loading }"
        >
          <button
            type="button"
            class="session-sidebar-item hover-bg"
            :class="{ active: bt.isActive }"
            :aria-current="bt.isActive ? 'true' : undefined"
            @click="onSelectBrowserTab(bt.tab)"
          >
            <SessionRowContent :item="bt.item" />
          </button>
          <span class="session-sidebar-pills-row" :class="{ active: bt.isActive }" @click="onSelectBrowserTab(bt.tab)">
            <span class="session-sidebar-pills" @click.stop>
              <BrowserTabActionPills :id="bt.tab.id" :url="bt.tab.url" />
            </span>
            <button
              type="button"
              class="pill-close-btn pill-tab-close-btn"
              aria-label="Close tab"
              data-tooltip="Close tab"
              @click.stop="browserTabStore.closeBrowserTab(bt.tab.id)"
            ><span class="mdi mdi-close"></span></button>
          </span>
        </li>
      </ul>

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
              :is-worktree="p.isWorktree"
              :is-dirty="p.dirty"
              :ahead="p.ahead"
              :behind="p.behind"
              :has-pr="p.hasPr"
              :has-action="p.hasAction"
              :has-dev-server="p.hasDevServer"
              :dispatch-count="p.dispatchCount"
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

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useBrowserTabStore, type BrowserTab } from "../stores/browserTabs.ts";
import { sessionSidebarItems, pendingDispatchSidebarItems, browserTabSidebarItems } from "../utils/session-sidebar.ts";
import { useGitHubPolling } from "../composables/useGitHubPolling.ts";
import { usePreviewPorts } from "../composables/usePreviewPorts.ts";
import { useDispatchQueue } from "../composables/useDispatchQueue.ts";
import { useInfoPillActions } from "../composables/useInfoPillActions.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { confirmCloseTab } from "../utils/tab-close-confirm.ts";
import BrowserTabActionPills from "./BrowserTabActionPills.vue";
import InfoPillRow from "./InfoPillRow.vue";
import SessionRowContent from "./SessionRowContent.vue";
import SessionSidebarRow from "./SessionSidebarRow.vue";
import { emit } from "../app-bridge.ts";
import { PILL_MAX_WIDTH_UNLIMITED_PX } from "../utils/constants.ts";

type SessionItem = ReturnType<typeof sessionSidebarItems>[number];
type PendingDispatchItem = ReturnType<typeof pendingDispatchSidebarItems>[number];

// セッション一覧オーバーレイ（SessionListPanel.vue）の中身。開いているタブ
// ごとにワークスペース名・ブランチ・変更サマリ・エージェント状態・
// Info Pillsを一覧表示する。行の組み立ては ui/utils/session-sidebar.ts
// （純粋関数）。
//
// Open Session/Settingsはタブバーの「+」/歯車ボタン（useSessionOpenNav.ts/
// useSettingsNav.ts）から独立して開くため、このビューからは直接遷移しない。

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const browserTabStore = useBrowserTabStore();
const { confirm } = useConfirm();

const browserTabItems = computed(() => browserTabSidebarItems(browserTabStore.tabs, browserTabStore.activeBrowserTabId));

function onSelectBrowserTab(tab: BrowserTab) {
  browserTabStore.selectBrowserTab(tab.id);
}

// 各行のInfo Pills（TerminalPaneと同じピル群）用データ源。取得・重複排除・
// 参照カウント式ポーリングの実装は各composable側（TerminalPaneと共有）。
// PR/Actionsのポーリングは必ずペアで開始・停止するためuseGitHubPollingに集約。
const { prsByWorkspace, runsByWorkspace, startGitHubPolling, stopGitHubPolling } = useGitHubPolling();
const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling } = usePreviewPorts();
const { queue: dispatchQueue } = useDispatchQueue();

// 開いているタブが無いワークスペースでも承認待ちのdispatchを見逃さないよう、
// タブ一覧の下に別枠で出す（タブが既にあるワークスペースはInfoPillRowの
// dispatchピルで足りるため対象外）。通常のセッション行と同じ情報
// （Branch/Changes/PR/Actions/DevServer/Dispatchの各ピル）で出すため、
// 組み立てロジックはsessionSidebarItemsと共有する（session-sidebar.ts）。
const pendingDispatchWorkspaces = computed(() => {
  const openTabWorkspaces = new Set(terminalStore.openTabs.map((t) => t.workspace).filter((w): w is string => Boolean(w)));
  return pendingDispatchSidebarItems(workspaceStore.allWorkspaces, openTabWorkspaces, {
    prsByWorkspace: prsByWorkspace.value,
    runsByWorkspace: runsByWorkspace.value,
    previewPorts: previewPorts.value,
    dispatchQueue: dispatchQueue.value,
    hostname: location.hostname,
  });
});

function onOpenPendingDispatch(p: PendingDispatchItem) {
  workspaceStore.selectedWorkspace = p.workspace;
  // 承認待ちが1件だけなら一覧を経由せずRun Dispatchへ直接飛ぶ。
  const dispatchItemId = p.dispatchItems.length === 1 ? (p.dispatchItems[0] as unknown as { id: string }).id : undefined;
  emit("git:openFileModal", { pane: "dispatch", dispatchItemId });
}

// pendingワークスペース行はBranch/PR/Actions/DevServer等のピルも通常の行と
// 同じく出すため、それぞれ対応するペインへ遷移できるよう
// useInfoPillActionsを共有する（タブが無いのでitem.tab固定でopenPaneのみ使う）。
// dispatchキーだけはonOpenPendingDispatchと同じ1件ショートカットを使う。
function onPendingPillOpen(p: PendingDispatchItem, key: string) {
  if (key === "dispatch") { onOpenPendingDispatch(p); return; }
  workspaceStore.selectedWorkspace = p.workspace;
  openPaneFor({ workspace: p.workspace }, p, key);
}

// useInfoPillActions を都度組み立てて対応ペインを開く（通常行 / pending行 共通）。
function openPaneFor(
  tab: Record<string, any>,
  source: { isGitRepo: boolean; devServerEntry: Record<string, any> | null; ahead?: number; behind?: number },
  key: string,
) {
  const { openPane } = useInfoPillActions({
    tab: ref(tab),
    isGitRepo: ref(source.isGitRepo),
    devServerEntry: ref(source.devServerEntry),
    ahead: ref(source.ahead || 0),
    behind: ref(source.behind || 0),
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

function onSelect(item: SessionItem) {
  // ターミナルタブへ切り替える時は前面に出ているブラウザタブを退避させる
  // （TabBar.vue の onSelect と同じ理由）。
  browserTabStore.activeBrowserTabId = null;
  if (item.id !== terminalStore.activeTabId) {
    // モバイルはタッチ操作前提のため、ソフトキーボードの誤起動を避けて skipFocus。
    emit("tab:select", { tab: item.tab, skipFocus: layoutStore.isPanelBottom });
  } else {
    // 既にアクティブなタブ（タブが1つしかない場合等）は switchTab() を経由しないため、
    // ここで明示的にバッジをクリアする（そうしないと通知が消えないまま残る）。
    terminalStore.clearSessionNotifyBadges(item.tab.sessionId);
  }
  // タブ切替えではサイドバー/オーバーレイを閉じない（モバイルでも同様）。
  // 閉じるのはハンバーガー/閉じるボタン・Escでの明示操作のみにする。
}

// ピルタップ：そのタブへ切替えてから対応ペインを開く（TerminalPaneの
// ピルと同じ遷移をuseInfoPillActionsで再利用する）。
function onPillOpen(item: SessionItem, key: string) {
  if (item.id !== terminalStore.activeTabId) {
    emit("tab:select", { tab: item.tab, skipFocus: layoutStore.isPanelBottom });
  }
  // openPaneが積むビュー（WorkspaceDetail等）は同じ共有スタックの続きとして
  // 表示されるため、ここでサイドバー自体を閉じない（閉じると開いた直後の
  // ビューごと隠れてしまう）。
  openPaneFor(item.tab, item, key);
}

// タブを閉じる（破壊的操作のため、TerminalPaneと同じ確認ダイアログを通す）。
async function onCloseTab(item: SessionItem) {
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
  const keys = new Set<string>();
  for (const tab of terminalStore.openTabs) {
    if (!tab.workspace) continue;
    const ws = workspaceStore.allWorkspaces.find((w) => w.name === tab.workspace);
    if (ws?.is_git_repo && ws?.github_url) keys.add(tab.workspace);
  }
  return [...keys];
});

let activeGitHubKeys: string[] = [];
watch(githubWorkspaceKeys, (keys) => {
  const keySet = new Set(keys);
  for (const old of activeGitHubKeys) {
    if (!keySet.has(old)) stopGitHubPolling(old);
  }
  for (const key of keys) {
    if (!activeGitHubKeys.includes(key)) startGitHubPolling(key);
  }
  activeGitHubKeys = keys;
}, { immediate: true });

startPreviewPolling();

onBeforeUnmount(() => {
  for (const key of activeGitHubKeys) stopGitHubPolling(key);
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
  /* ui/styles/modal-shell.css の .settings-panel-body .modal-scroll-body は
     GitHistory/GitStash等の共通ガター(左右8px)だが、セッション行はactive背景
     を左右の端いっぱいまで敷きたいためこのビューだけ0にする。行内テキストの
     余白は .session-sidebar-item 自身のpadding(8px 12px)で確保する。 */
  padding: 0 !important;
}

.session-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.session-sidebar-list {
  list-style: none;
  margin: 0;
  padding: 0 0 4px;
}

/* pending行の一覧は見出しを出さず、開いているセッション一覧との区切りは
   session-sidebar.css の .session-sidebar-li が最後の行にも border-bottom を
   出す設計に委ねる（ここで border-top も足すと隣接して二重線に見えるため
   持たない）。 */

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
