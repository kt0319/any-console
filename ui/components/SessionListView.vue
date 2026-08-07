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

      <template v-if="detachedSessions.length > 0">
        <button
          type="button"
          class="session-sidebar-detached-head"
          :aria-expanded="detachedExpanded ? 'true' : 'false'"
          @click="detachedExpanded = !detachedExpanded"
        >
          <span class="mdi" :class="detachedExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right'" aria-hidden="true"></span>
          <span>Detached</span>
          <span class="session-sidebar-detached-count">{{ detachedSessions.length }}</span>
        </button>
        <ul v-if="detachedExpanded" class="session-sidebar-list">
          <li v-for="s in detachedSessions" :key="s.tmux_name" class="session-sidebar-li" :data-session-id="s.session_id || null">
            <div class="session-sidebar-item session-sidebar-item-detached">
              <span class="session-sidebar-main">
                <span class="mdi mdi-tab-plus session-sidebar-icon session-sidebar-icon-default"></span>
                <span class="session-sidebar-label">
                  {{ s.workspace || s.job_label || s.job_name || (s.external ? s.tmux_name : "terminal") }}
                </span>
                <span v-if="s.external" class="session-sidebar-detached-tag">external</span>
              </span>
            </div>
            <span class="session-sidebar-pills-row">
              <span class="session-sidebar-detached-actions">
                <button v-if="!s.external" type="button" class="session-sidebar-detached-btn" @click="openDetached(s)" title="Open as tab">
                  <span class="mdi mdi-tab-plus"></span>
                </button>
                <button v-else type="button" class="session-sidebar-detached-btn" @click="adoptDetached(s)" title="Adopt into any-console (rename tmux session)">
                  <span class="mdi mdi-import"></span>
                </button>
                <button type="button" class="session-sidebar-detached-btn danger" @click="closeDetached(s)" title="Close session">
                  <span class="mdi mdi-close"></span>
                </button>
              </span>
            </span>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, inject } from "vue";
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
import { useApi } from "../composables/useApi.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import { buildDetachedSessionList } from "../utils/detached-sessions.js";
import { buildSessionTabParamsWithCache } from "../composables/useSessionSync.js";
import { getWithRetry } from "../utils/api-retry.js";
import {
  EP_TERMINAL_SESSIONS,
  EP_SYSTEM_TMUX_INFO,
  EP_SYSTEM_TMUX_ADOPT,
  EP_SYSTEM_TMUX_KILL,
  EP_JOBS_WORKSPACES,
  terminalSessionPath,
  terminalWsPath,
  terminalSessionDetachedPath,
} from "../utils/endpoints.js";
import InfoPillRow from "./InfoPillRow.vue";
import SessionRowContent from "./SessionRowContent.vue";
import { emit } from "../app-bridge.js";

// 統合ナビゲーション（useSettingsNav.js）の一番手前（ルート）のビュー。
// 開いているタブごとにワークスペース名・ブランチ・変更サマリ・エージェント
// 状態・Info Pillsを一覧表示する。
// 行の組み立ては ui/utils/session-sidebar.js（純粋関数）。
//
// Sessions/Dispatches/Dev Server/Open/Settingsの切替えタブ帯は
// SettingsPanel.vue側の常設表示に移した（設定の奥の画面まで掘り下げても
// タブ帯を消さないため。詳細はSettingsPanel.vueのコメント参照）。このビュー
// 自体は純粋にセッション一覧の中身だけを担当する。

const modalTitle = inject("modalTitle");
modalTitle.value = "Sessions";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const { confirm } = useConfirm();
const { apiGet, apiDelete, apiPost, apiPut } = useApi();

// Detached sessions（タブに紐付いていないtmuxセッション）をSessions一覧に
// 続ける形で表示する。タブ一覧とは別物のためポーリングはせず、マウント時と
// 操作（Open/Adopt/Close）のたびに再取得する。折りたたみ式（既定は閉じておき、
// 件数バッジだけ見せる）。
const detachedSessions = ref([]);
const detachedExpanded = ref(false);
const allJobsData = ref({});

async function loadDetachedSessions() {
  const [tmuxRes, ownedRes, jobsRes] = await Promise.all([
    getWithRetry(apiGet, EP_SYSTEM_TMUX_INFO),
    getWithRetry(apiGet, EP_TERMINAL_SESSIONS),
    getWithRetry(apiGet, EP_JOBS_WORKSPACES),
  ]);
  allJobsData.value = jobsRes.ok && jobsRes.data ? jobsRes.data : {};
  const owned = ownedRes.ok && Array.isArray(ownedRes.data) ? ownedRes.data : [];
  const knownTabIds = new Set(terminalStore.openTabs.map((t) => t.sessionId).filter(Boolean));
  const all = tmuxRes.ok && Array.isArray(tmuxRes.data?.sessions) ? tmuxRes.data.sessions : [];
  const prefix = tmuxRes.ok && tmuxRes.data?.prefix ? tmuxRes.data.prefix : undefined;
  detachedSessions.value = buildDetachedSessionList(all, owned, knownTabIds, prefix);
}

function openDetached(s) {
  const tab = terminalStore.addTerminalTab({
    ...buildSessionTabParamsWithCache(s, { workspaces: workspaceStore.allWorkspaces, allJobs: allJobsData.value }),
    wsUrl: terminalWsPath(s.session_id),
    jobLabel: s.job_label || (s.workspace || s.session_id),
    restored: false,
  });
  apiPut(terminalSessionDetachedPath(s.session_id), { detached: false }).catch(() => {});
  emit("tab:select", { tab });
  loadDetachedSessions();
}

async function adoptDetached(s) {
  // 外部 tmux セッションを ac- プレフィックスにリネームして any-console 管理化、
  // そのままタブとして開く。
  if (!await confirm(`Adopt "${s.tmux_name}" into any-console? The tmux session will be renamed.`)) return;
  const { ok, data } = await apiPost(EP_SYSTEM_TMUX_ADOPT, { name: s.tmux_name }, { errorMessage: "Failed to adopt session" });
  if (!ok || !data?.session_id) return;
  const tab = terminalStore.addTerminalTab({
    wsUrl: terminalWsPath(data.session_id),
    workspace: null,
    wsIcon: null,
    wsIconColor: null,
    icon: "mdi-console",
    iconColor: null,
    jobName: null,
    jobLabel: s.tmux_name,
    restored: false,
  });
  emit("tab:select", { tab });
  await loadDetachedSessions();
}

async function closeDetached(s) {
  const label = s.workspace || s.session_id || s.tmux_name;
  if (!await confirm(`Close session "${label}"? The tmux session will be killed.`)) return;
  if (s.session_id) {
    // any-console 管理セッションは /terminal/sessions API で kill
    await apiDelete(terminalSessionPath(s.session_id), { errorMessage: "Failed to close session" });
  } else {
    // 外部セッション。/system/tmux/kill 経由
    await apiPost(EP_SYSTEM_TMUX_KILL, { name: s.tmux_name }, { errorMessage: "Failed to kill session" });
  }
  await loadDetachedSessions();
}

// 各行のInfo Pills（TerminalPaneと同じピル群）用データ源。取得・重複排除・
// 参照カウント式ポーリングの実装は各composable側（TerminalPaneと共有）。
const { prsByWorkspace, fetchPRs, startPolling: startPRsPolling, stopPolling: stopPRsPolling } = useWorkspacePRs();
const { runsByWorkspace, fetchRuns, startPolling: startActionsPolling, stopPolling: stopActionsPolling } = useWorkspaceActions();
const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling } = usePreviewPorts();
const { queue: dispatchQueue } = useDispatchConfirm();

const activeTabId = computed(() => terminalStore.activeTabId);

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
onMounted(loadDetachedSessions);

// このビューが開いている間にタブがDetachされる（TabItem/TerminalPaneの
// 閉じるダイアログ経由）と開いているタブ数が減る。マウント時の1回取得だけ
// では反映されないため、タブ数が変わるたびに再取得して同期する。
watch(() => terminalStore.openTabs.length, loadDetachedSessions);

onBeforeUnmount(() => {
  for (const key of activeGithubKeys) {
    stopPRsPolling(key);
    stopActionsPolling(key);
  }
  stopPreviewPolling();
});
</script>

<style scoped>
.session-list-scroll {
  flex: 1;
  min-height: 0;
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
  animation: session-sidebar-working-pulse 2s linear infinite;
}

@keyframes session-sidebar-working-pulse {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

.session-sidebar-item.session-phrase-notify:not(.active),
.session-sidebar-item.session-blocked:not(.active),
.session-sidebar-pills-row.session-phrase-notify:not(.active),
.session-sidebar-pills-row.session-blocked:not(.active) {
  background-image: none;
  animation: session-sidebar-notify-blink 1.2s ease-in-out infinite;
}

@keyframes session-sidebar-notify-blink {
  0%, 100% { background-color: transparent; }
  50% { background-color: rgba(130, 170, 255, 0.35); }
}

.session-sidebar-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: var(--text-muted);
}

/* Detached sessions（タブに紐付いていないtmuxセッション）はSessions一覧に
   続ける形で表示する。行の見た目は.session-sidebar-item/.session-sidebar-main
   /.session-sidebar-pills-rowをそのまま流用し、末尾のアクション部分だけ
   Open/Adopt/Closeボタンに差し替える。 */
.session-sidebar-detached-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  margin-top: 8px;
  min-height: 36px;
  padding: 6px 12px;
  border: none;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: left;
  cursor: pointer;
}

.session-sidebar-detached-head .mdi {
  font-size: 16px;
}

@media (hover: hover) and (pointer: fine) {
  .session-sidebar-detached-head:hover {
    color: var(--text-primary);
  }
}

.session-sidebar-detached-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.session-sidebar-item-detached {
  cursor: default;
}

.session-sidebar-detached-tag {
  margin-left: 6px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.session-sidebar-detached-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.session-sidebar-detached-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
}

.session-sidebar-detached-btn.danger:hover {
  background: color-mix(in srgb, var(--error) 20%, var(--bg-tertiary));
  color: var(--error);
}
</style>
