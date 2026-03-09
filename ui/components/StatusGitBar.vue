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
    <div v-if="isGitRepo && hasGitActions" class="git-actions" style="display:flex">
      <button
        v-if="behind > 0"
        type="button"
        class="git-action-btn pull-btn has-count"
        :class="{ running: runningAction === 'pull' }"
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
        :class="{ running: runningAction === 'set-upstream' }"
        title="追跡設定"
        @click="gitAction('set-upstream')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      </button>
      <button
        v-if="!hasUpstream && !hasRemoteBranch"
        type="button"
        class="git-action-btn upstream-btn"
        :class="{ running: runningAction === 'push-upstream' }"
        title="Push"
        @click="gitAction('push-upstream')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 16 12 10 18 16"/><polyline points="6 10 12 4 18 10"/></svg>
        <span class="git-action-count">{{ ahead }}</span>
      </button>
      <button
        v-if="hasUpstream && ahead > 0"
        type="button"
        class="git-action-btn push-btn has-count"
        :class="{ running: runningAction === 'push' }"
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
import { ref, computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useAuthStore } from "../stores/auth.js";
import { emit } from "../app-bridge.js";

const auth = useAuthStore();

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

const ACTION_LABELS = {
  pull: "Pull",
  push: "Push",
  "push-upstream": "Push (upstream設定)",
  "set-upstream": "追跡設定",
};

const runningAction = ref(null);

async function gitAction(action) {
  const ws = workspace.value;
  if (!ws) return;
  if (runningAction.value) return;
  const label = ACTION_LABELS[action] || action;
  if (!confirm(`${label} を実行しますか？`)) return;
  runningAction.value = action;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(ws)}/${action}`, {
      method: "POST",
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      emit("toast:show", { message: data?.stderr || `${label}に失敗しました`, type: "error" });
      return;
    }
    const data = await res.json();
    if (data.exit_code !== 0) {
      emit("toast:show", { message: data.stderr || `${label}に失敗しました`, type: "error" });
      return;
    }
    emit("toast:show", { message: `${label}完了`, type: "success" });
    workspaceStore.fetchStatuses(auth);
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
  } finally {
    runningAction.value = null;
  }
}
</script>
