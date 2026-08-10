<template>
  <div class="modal-scroll-body session-list-view">
    <div class="session-list-scroll">
      <ul v-if="items.length > 0" class="session-sidebar-list">
        <li v-for="item in items" :key="item.id" class="session-sidebar-li" :class="sessionRowStateClasses(item)">
          <button
            type="button"
            class="session-sidebar-item hover-bg"
            :class="sessionRowStateClasses(item)"
            :aria-current="item.id === activeTabId ? 'true' : undefined"
            @click="onSelect(item)"
          >
            <SessionRowContent :item="item" />
          </button>
          <span
            class="session-sidebar-pills-row"
            :class="sessionRowStateClasses(item)"
            @click="onSelect(item)"
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
              :max-width="9999"
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

    <div class="session-list-menu">
      <button type="button" class="settings-menu-item" @click="pushView('WorkspaceOpen')">
        <span class="mdi mdi-folder-plus-outline"></span> Open Session
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
import { sessionSidebarItems, pendingDispatchSidebarItems } from "../utils/session-sidebar.js";
import { useGithubPolling } from "../composables/useGithubPolling.js";
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
// Open Session/Settingsへは下部固定のメニュー（本物のpushView遷移）から進む。
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

// 行（li）・本体ボタン・ピル行の3要素で、active/working/blocked/phrase通知の
// クラスを揃えて付与するための共通関数。以前は3箇所に同じオブジェクトを
// 書いていたため、アニメーション対象が要素ごとにズレて統一感なく見える
// 原因になっていた（左インジケーターの演出はliの::beforeに1本化したが、
// クラス自体はli/button/pills-row全てに要る — CSSの`:not(.active)`等の
// セレクタが各要素のクラスを直接見るため）。
function sessionRowStateClasses(item) {
  return {
    active: item.id === activeTabId.value,
    "session-working": item.agent?.className === "agent-state-working",
    "session-blocked": item.agent?.className === "agent-state-blocked",
    "session-phrase-notify": !!item.phraseNotify,
  };
}

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
  const { openPane } = useInfoPillActions({
    tab: ref({ workspace: p.workspace }),
    isGitRepo: ref(p.isGitRepo),
    devServerEntry: ref(p.devServerEntry),
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
  const { openPane } = useInfoPillActions({
    tab: ref(item.tab),
    isGitRepo: ref(item.isGitRepo),
    devServerEntry: ref(item.devServerEntry),
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
  background: var(--accent-bg-12);
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

/* working/blocked時、個々のピル（.pill-chip.pill-working/.pill-blocked、
   ui/styles/info-pills.css）が持つ独自アニメーションはサイドバーでは止める。
   行（li）側に統一済みの左インジケーターが既にworking/blockedを示している
   ため、ピルごとにも動くと同じ情報が別々のタイミングで何重にも動いて見えて
   しまう。TerminalPane側の浮遊ピル（.terminal-pane .pill-chip）は対象外。 */
.session-sidebar-pills :deep(.pill-chip.pill-working),
.session-sidebar-pills :deep(.pill-chip.pill-blocked) {
  animation: none;
  background-image: none;
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

/* 通常ホバーは base.css の .hover-bg（テンプレート側で付与）。アクティブ行は
   ホバーでもアクティブ強調色を維持する。 */
@media (hover: hover) and (pointer: fine) {
  .session-sidebar-item.active:hover {
    background: var(--accent-bg-12);
  }

  /* ピル行（.session-sidebar-pills-row）はボタンではなく独立した兄弟要素の
     ため、その上をホバーしても本体行（.session-sidebar-item）のhover-bgは
     効かない。行全体（li）を1つのホバー対象として扱い、ピル行の上にいる時も
     本体行と同じ背景で連動させる（分断して見えないようにするため）。 */
  .session-sidebar-li:hover .session-sidebar-item:not(.active) {
    background: var(--bg-tertiary);
  }

  .session-sidebar-li:hover .session-sidebar-pills-row:not(.active) {
    background: var(--bg-tertiary);
  }
}

.session-sidebar-item.active {
  color: var(--text-primary);
  background: var(--accent-bg-12);
  border-left-color: var(--accent);
}

/* working（出力中）・blocked/phrase通知は、行全体ではなく左3pxのアクティブ
   インジケーター（border-left。アクティブ行が常時 var(--accent) で点灯する
   のと同じ場所）の中だけで動かす。以前はタブと同じ「行全体が流れる/点滅する」
   演出（ui/styles/base.css）を共用していたが、セッション一覧はタブより行数が
   多く常時視界に入るため、行全体が動くとうるさく感じやすい。アクティブな行は
   既に強調色がついているため対象外にする。

   インジケーターは行（li）に1本だけ持たせる。以前は本体ボタンとピル行の
   両方に別々の演出（別々のアニメーションインスタンス）を付けていたため、
   2つの要素の間でアニメーションのタイミングがズレて統一感なく見えていた。
   li側は元々border-bottomのみでレイアウト用のボーダーを持たないため、
   ::beforeで独立した3px幅のオーバーレイを敷く（blocked/phrase通知の点滅も
   border-left-colorではなくこの::beforeで揃え、演出方式を1本化する）。

   working: タブ（ui/styles/base.css working-pulse）と同じ「一方向に流れ
   続ける」イメージを縦方向にしたもの（上→下へループ、ease-in-outの往復では
   なくlinearの一方通行）。
   blocked/phrase通知: より緊急度が高いため点滅で目立たせる（working と
   同時に付いている場合は点滅を優先し、上下スイープは止める）。 */
.session-sidebar-li {
  position: relative;
}

.session-sidebar-li.session-working:not(.active)::before,
.session-sidebar-li.session-phrase-notify:not(.active)::before,
.session-sidebar-li.session-blocked:not(.active)::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  width: 3px;
  height: 100%;
}

.session-sidebar-li.session-working:not(.active)::before {
  /* アクティブ行の左インジケーター（var(--accent)そのまま）と見分けが付くよう
     working中はそれより少し暗い色にする。 */
  background-image: linear-gradient(
    180deg,
    transparent 0%,
    transparent 10%,
    color-mix(in srgb, var(--accent) 70%, black) 50%,
    transparent 90%,
    transparent 100%
  );
  background-size: 100% 200%;
  animation: session-sidebar-working-sweep 2s linear infinite;
}

/* タブのworking-pulse（200%↔-200%、background-size 200%）と移動量/背景サイズの
   比率を揃え、体感速度を一致させる。上→下の向き自体はこれまで通り維持する。 */
@keyframes session-sidebar-working-sweep {
  0% { background-position: 0% -200%; }
  100% { background-position: 0% 200%; }
}

.session-sidebar-li.session-phrase-notify:not(.active)::before,
.session-sidebar-li.session-blocked:not(.active)::before {
  background-image: none;
  background-color: var(--accent);
  animation: session-sidebar-notify-blink 1.2s ease-in-out infinite;
}

@keyframes session-sidebar-notify-blink {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}

.session-sidebar-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: var(--text-muted);
}

/* Open Session/Settingsへの入口。一覧の下に固定表示するメニュー。
   行ボタンの見た目（.settings-menu-item / .settings-menu-version）は
   ui/styles/settings-form.css（グローバル）でModalMenu.vueと共用する。 */
.session-list-menu {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

.session-list-menu .settings-menu-item:last-child {
  border-bottom: none;
}

</style>
