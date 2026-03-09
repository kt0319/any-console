<template>
  <div class="header-row2" :style="{ display: showHeader ? 'flex' : 'none' }">
    <button
      v-if="isGitRepo"
      type="button"
      class="commit-msg-btn"
      :title="commitTooltip"
      @click="openFileModal"
      v-html="commitMsgHtml + numstatHtml"
    />
    <button
      v-if="!isGitRepo && workspace"
      type="button"
      class="non-git-hint commit-msg-btn"
      @click="openFileModal"
    >Gitリポジトリではありません</button>
    <div v-if="isGitRepo && hasGitActions" class="git-actions">
      <GitActionBtn v-if="behind > 0" icon="pull" title="Pull" :count="behind" :running="isRunning(workspace, 'pull')" btn-class="pull-btn has-count" @action="doAction('pull')" />
      <GitActionBtn v-if="!hasUpstream && hasRemoteBranch" icon="set-upstream" title="追跡設定" :running="isRunning(workspace, 'set-upstream')" btn-class="icon-only upstream-set-btn" @action="doAction('set-upstream')" />
      <GitActionBtn v-if="!hasUpstream && !hasRemoteBranch" icon="push-upstream" title="Push" :count="ahead" :running="isRunning(workspace, 'push-upstream')" btn-class="upstream-btn" @action="doAction('push-upstream')" />
      <GitActionBtn v-if="hasUpstream && ahead > 0" icon="push" title="Push" :count="ahead" :running="isRunning(workspace, 'push')" btn-class="push-btn has-count" @action="doAction('push')" />
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useGitAction } from "../composables/useGitAction.js";
import { emit } from "../app-bridge.js";
import GitActionBtn from "./GitActionBtn.vue";

const { gitAction, isRunning } = useGitAction();

const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const activeTab = computed(() =>
  terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId),
);
const workspace = computed(() => activeTab.value?.workspace || null);
const showHeader = computed(() => !layoutStore.splitMode && !!workspace.value);

const ws = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === workspace.value),
);

const isGitRepo = computed(() => ws.value?.is_git_repo === true);
const hasUpstream = computed(() => ws.value?.has_upstream !== false);
const hasRemoteBranch = computed(() => ws.value?.has_remote_branch !== false);
const ahead = computed(() => ws.value?.ahead || 0);
const behind = computed(() => ws.value?.behind || 0);

const hasGitActions = computed(() =>
  behind.value > 0 || ahead.value > 0 || !hasUpstream.value,
);
const isDirty = computed(() => ws.value && ws.value.clean === false);

const commitMsgHtml = computed(() => {
  if (!ws.value) return "";
  const branch = ws.value.branch || "";
  const msg = isDirty.value ? "未コミットの変更" : (ws.value.last_commit_message || "");
  const msgClass = isDirty.value ? "commit-btn-msg commit-btn-msg-muted" : "commit-btn-msg";
  const escaped = escapeHtml(msg);
  return `<span class="commit-btn-branch">${escapeHtml(branch)}</span>` +
    `<span class="commit-btn-msg-wrap"><span class="${msgClass}">${escaped}</span></span>`;
});

const commitTooltip = computed(() => "コミット履歴");

const numstatHtml = computed(() => {
  if (!ws.value || !isDirty.value) return "";
  const changedFiles = ws.value.changed_files || 0;
  const insertions = ws.value.insertions || 0;
  const deletions = ws.value.deletions || 0;
  const fileCountHtml = changedFiles > 0 ? `<span class="header-git-files">${changedFiles}F</span>` : "";
  return `<span class="header-git-numstat">${fileCountHtml}<span class="diff-num-plus">+${insertions}</span><span class="diff-num-del">-${deletions}</span></span>`;
});

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function openFileModal() {
  if (workspace.value) {
    workspaceStore.selectedWorkspace = workspace.value;
  }
  emit("git:openFileModal");
}

function doAction(action) {
  const wsName = workspace.value;
  if (!wsName) return;
  const branch = ws.value?.branch || "";
  gitAction(wsName, action, { branch });
}
</script>
