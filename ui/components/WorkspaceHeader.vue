<template>
  <div class="header-row2" :style="{ display: showHeader ? 'flex' : 'none' }">
    <button
      v-if="isGitRepo"
      type="button"
      class="commit-msg-btn"
      :title="commitTooltip"
      @click="openFileModal"
      v-html="commitMsgHtml"
    />
    <div v-if="isGitRepo" class="git-summary-panel" v-html="gitStatusHtml"></div>
    <button
      v-if="!isGitRepo && workspace"
      type="button"
      class="non-git-hint commit-msg-btn"
      @click="openFileModal"
    >Gitリポジトリではありません</button>
    <div v-if="isGitRepo && hasGitActions" class="git-actions" style="display:flex">
      <button
        v-if="behind > 0"
        type="button"
        class="git-action-btn pull-btn"
        title="Pull"
        @click="gitAction('pull')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
        <span class="git-action-count">{{ behind }}</span>
      </button>
      <button
        v-if="!hasUpstream && hasRemoteBranch"
        type="button"
        class="git-action-btn icon-only upstream-set-btn"
        title="追跡設定"
        @click="gitAction('set-upstream')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </button>
      <button
        v-if="!hasUpstream && !hasRemoteBranch"
        type="button"
        class="git-action-btn upstream-btn"
        title="Push"
        @click="gitAction('push-upstream')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 16 12 10 18 16"/><polyline points="6 10 12 4 18 10"/></svg>
        <span class="git-action-count">{{ ahead }}</span>
      </button>
      <button
        v-if="hasUpstream && ahead > 0"
        type="button"
        class="git-action-btn push-btn"
        title="Push"
        @click="gitAction('push')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
        <span class="git-action-count">{{ ahead }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";
import { emit } from "../app-bridge.js";

const workspaceStore = useWorkspaceStore();
const layoutStore = useLayoutStore();

const workspace = computed(() => workspaceStore.selectedWorkspace);
const showHeader = computed(() => workspace.value && !layoutStore.splitMode);

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

const isDirty = computed(() => ws.value && !ws.value.clean);

const commitMsgHtml = computed(() => {
  if (!ws.value) return "";
  const branch = ws.value.branch || "";
  const msg = isDirty.value ? "未コミットの変更" : (ws.value.last_commit_message || "");
  const escaped = escapeHtml(msg);
  return branch ? `<span class="branch-name">${escapeHtml(branch)}</span> ${escaped}` : escaped;
});

const commitTooltip = computed(() => "コミット履歴");

const gitStatusHtml = computed(() => {
  if (!ws.value || !isDirty.value) return "";
  const parts = [];
  if (ws.value.added) parts.push(`<span class="numstat-added">+${ws.value.added}</span>`);
  if (ws.value.modified) parts.push(`<span class="numstat-modified">~${ws.value.modified}</span>`);
  if (ws.value.deleted) parts.push(`<span class="numstat-deleted">-${ws.value.deleted}</span>`);
  if (ws.value.untracked) parts.push(`<span class="numstat-untracked">?${ws.value.untracked}</span>`);
  return parts.join(" ");
});

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function openFileModal() {
  emit("git:openFileModal");
}

function gitAction(action) {
  emit("git:action", { action, workspace: workspace.value });
}
</script>
