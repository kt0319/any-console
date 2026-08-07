<template>
  <nav
    v-if="isOpen"
    class="session-sidebar"
    :class="{ 'session-sidebar-full': isPanelBottom }"
    aria-label="Sessions"
  >
    <ul v-if="items.length > 0" class="session-sidebar-list">
      <li v-for="item in items" :key="item.id" class="session-sidebar-li">
        <button
          type="button"
          class="session-sidebar-item"
          :class="{ active: item.id === activeTabId }"
          :aria-current="item.id === activeTabId ? 'true' : undefined"
          @click="onSelect(item)"
        >
          <span class="session-sidebar-main">
            <span v-if="iconHtml(item)" class="session-sidebar-icon" v-html="iconHtml(item)"></span>
            <span v-else class="mdi mdi-console session-sidebar-icon session-sidebar-icon-default"></span>
            <span v-if="item.isWorktree" class="mdi mdi-file-tree session-sidebar-worktree" aria-label="worktree"></span>
            <span class="session-sidebar-label">{{ item.label }}</span>
            <span v-if="item.dirty" class="session-sidebar-dirty-badge" aria-label="uncommitted changes"></span>
            <span v-if="item.phraseNotify" class="mdi mdi-bell-ring-outline session-sidebar-notify" aria-label="phrase detected"></span>
          </span>
          <span v-if="item.branch || item.agent" class="session-sidebar-sub">
            <span v-if="item.branch" class="session-sidebar-branch">
              <span class="mdi mdi-source-branch" aria-hidden="true"></span>
              <span class="session-sidebar-branch-name">{{ item.branch }}</span>
              <span v-if="item.ahead > 0" class="session-sidebar-count count-ahead"><span class="mdi mdi-arrow-up-thin" aria-hidden="true"></span>{{ item.ahead }}</span>
              <span v-if="item.behind > 0" class="session-sidebar-count count-behind"><span class="mdi mdi-arrow-down-thin" aria-hidden="true"></span>{{ item.behind }}</span>
            </span>
            <span v-if="item.dirty" class="session-sidebar-changes">{{ item.changedFiles }}F +{{ item.insertions }} -{{ item.deletions }}</span>
            <span v-if="item.agent" class="session-sidebar-agent" :class="item.agent.className">
              <span class="mdi" :class="item.agent.icon" aria-hidden="true"></span>{{ item.agent.label }}
            </span>
          </span>
        </button>
      </li>
    </ul>
    <div v-else class="session-sidebar-empty">No sessions</div>
  </nav>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { renderIconStr } from "../utils/render-icon.js";
import { sessionSidebarItems } from "../utils/session-sidebar.js";
import { emit } from "../app-bridge.js";

// タブバー左端のハンバーガーで開くセッションサイドバー。開いているタブごとに
// ワークスペース名・ブランチ・変更サマリ・エージェント状態を一覧表示する。
// PC ではコンテンツ左側のパネル、モバイル（panel-bottom）ではコンテンツ領域
// 全面のオーバーレイになり、選択するとタブ（ターミナル表示）へ戻る。
// 行の組み立ては ui/utils/session-sidebar.js（純粋関数）。

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();

// 分割モード中はタブバー（ハンバーガー）自体が隠れるため、サイドバーも出さない。
const isOpen = computed(() => layoutStore.isSessionSidebarOpen && !layoutStore.isSplitMode);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);
const activeTabId = computed(() => terminalStore.activeTabId);

const items = computed(() => {
  // tab は markRaw のため tab.workspace 単体の変更は追跡されない。
  // tabWorkspaceVersion を読んで依存に含める（TabItem と同じ理由）。
  terminalStore.tabWorkspaceVersion;
  return sessionSidebarItems(terminalStore.openTabs, workspaceStore.allWorkspaces, {
    tabFlags: terminalStore.tabFlags,
    agentStates: terminalStore.agentStates,
    phraseNotifySessions: terminalStore.phraseNotifySessions,
  });
});

function iconHtml(item) {
  return item.icon ? renderIconStr(item.icon.name, item.icon.color, 18) : "";
}

function onSelect(item) {
  if (item.id !== terminalStore.activeTabId) {
    // モバイルはタッチ操作前提のため、ソフトキーボードの誤起動を避けて skipFocus。
    emit("tab:select", { tab: item.tab, skipFocus: layoutStore.isPanelBottom });
  }
  // モバイルは全面表示のため、選択したらタブ（ターミナル表示）へ戻る。
  if (layoutStore.isPanelBottom) layoutStore.closeSessionSidebar();
}

// Esc で閉じる。モーダルの Esc（listenForEscape はキャプチャ段階で
// preventDefault する）と重ねて閉じないよう defaultPrevented を確認する。
function onKeydown(e) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!layoutStore.isSessionSidebarOpen) return;
  layoutStore.closeSessionSidebar();
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<style scoped>
.session-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 15; /* Modal.vue の .modal-overlay(z-index:20) より下、info-pills(10) より上 */
  width: 280px;
  max-width: 85vw;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

/* モバイル（panel-bottom）はコンテンツ領域の全面に表示する */
.session-sidebar-full {
  width: 100%;
  max-width: none;
  border-right: none;
}

.session-sidebar-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
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

.session-sidebar-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.session-sidebar-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex-shrink: 0;
  line-height: 1;
}

.session-sidebar-icon-default {
  color: var(--text-muted);
  font-size: 16px;
}

.session-sidebar-worktree {
  font-size: 13px;
  color: var(--accent);
  flex-shrink: 0;
}

.session-sidebar-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.session-sidebar-dirty-badge {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f5a623;
  flex-shrink: 0;
}

.session-sidebar-notify {
  color: var(--accent);
  font-size: 14px;
  flex-shrink: 0;
}

.session-sidebar-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
  padding-left: 24px;
  font-size: 12px;
  color: var(--text-muted);
}

.session-sidebar-branch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.session-sidebar-branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.session-sidebar-count {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
}

.session-sidebar-count.count-ahead {
  color: var(--accent);
}

.session-sidebar-count.count-behind {
  color: var(--warning);
}

.session-sidebar-changes {
  color: var(--warning);
  white-space: nowrap;
}

.session-sidebar-agent {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.session-sidebar-agent.agent-state-working {
  color: var(--accent);
}

.session-sidebar-agent.agent-state-working .mdi {
  animation: session-sidebar-working-spin 1.6s linear infinite;
}

.session-sidebar-agent.agent-state-blocked {
  color: var(--warning);
}

.session-sidebar-agent.agent-state-done {
  color: var(--success);
}

.session-sidebar-agent.agent-state-idle {
  color: var(--text-muted);
}

@keyframes session-sidebar-working-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.session-sidebar-empty {
  padding: 16px 12px;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
