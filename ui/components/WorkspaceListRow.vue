<template>
  <div
    class="picker-ws-group"
    :class="{ dragging, 'picker-ws-group-inset': inset }"
    :style="dragging ? { transform: `translateY(${dragOffsetY}px)` } : {}"
  >
    <div class="picker-ws-row picker-ws-row-top hover-bg">
      <span
        v-if="editMode"
        class="drag-handle picker-ws-drag-handle"
        aria-hidden="true"
        @pointerdown.prevent="$emit('dragStart', $event)"
      >
        <span class="mdi mdi-drag-vertical"></span>
      </span>
      <button type="button" class="picker-ws-header-label" @click="$emit('toggleJobs', ws)">
        <span v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
        <span class="picker-ws-header-text">
          <span class="picker-ws-name">
            <span v-if="ws.worktree" class="mdi mdi-file-tree picker-ws-wt-icon" aria-label="worktree" data-tooltip="worktree"></span>
            {{ ws.worktree ? workspaceDisplayName(ws) : ws.name }}
          </span>
          <span class="picker-ws-branch">{{ ws.branch || '-' }}</span>
        </span>
      </button>
      <div class="picker-ws-top-meta" @click.stop>
        <button v-if="ws.is_git_repo && ws.clean === false && !editMode" type="button" class="git-badge dirty" aria-label="Open changes" data-tooltip="Open changes" v-html="dirtyBadgeHtml(ws)" @click.stop="$emit('openChanges', ws)"></button>
        <template v-if="ws.is_git_repo && !editMode">
          <GitActionBtn v-if="ws.behind > 0" icon="pull" title="Pull" :count="ws.behind" :running="isRunning(ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="$emit('gitAction', ws, 'pull')" />
          <GitActionBtn v-if="ws.ahead > 0" icon="push" title="Push" :count="ws.ahead" :running="isRunning(ws.name, pushActionFor(ws))" btn-class="picker-ws-mini-btn push-btn has-count" @action="$emit('gitAction', ws, pushActionFor(ws))" />
        </template>
        <template v-if="editMode">
          <button type="button" class="picker-ws-edit-btn hover-bg-text" aria-label="Edit workspace" data-tooltip="Edit workspace" @click.stop="$emit('edit', ws)">
            <span class="mdi mdi-pencil-outline"></span>
          </button>
        </template>
      </div>
      <span class="mdi picker-ws-jobs-chevron" :class="expandedWorkspace === ws.name ? 'mdi-chevron-up' : 'mdi-chevron-down'" aria-hidden="true"></span>
    </div>
    <div v-if="expandedWorkspace === ws.name" class="picker-ws-jobs-inline">
      <WorkspaceJobsPane :workspace="ws.name" :edit-mode="editMode" />
    </div>
    <div v-if="worktrees.length" class="picker-ws-worktrees">
      <template v-for="wt in worktrees" :key="wt.name">
        <div class="picker-ws-worktree-item">
          <button type="button" class="picker-ws-worktree-open hover-bg" @click="$emit('toggleJobs', wt)">
            <span class="mdi mdi-file-tree picker-ws-wt-child-icon"></span>
            <span class="picker-ws-worktree-branch">{{ worktreeBranchLabel(wt.worktree_branch || wt.branch) }}</span>
            <span v-if="wt.clean === false" class="picker-ws-wt-dirty" aria-label="uncommitted changes"></span>
          </button>
          <button v-if="editMode" type="button" class="picker-ws-worktree-del" aria-label="Remove worktree" data-tooltip="Remove worktree" @click.stop="$emit('removeWorktree', ws, wt)">
            <span class="mdi mdi-delete-outline"></span>
          </button>
          <span class="mdi picker-ws-jobs-chevron" :class="expandedWorkspace === wt.name ? 'mdi-chevron-up' : 'mdi-chevron-down'" aria-hidden="true"></span>
        </div>
        <div v-if="expandedWorkspace === wt.name" class="picker-ws-jobs-inline">
          <WorkspaceJobsPane :workspace="wt.name" :edit-mode="editMode" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type PropType } from "vue";
import GitActionBtn from "./GitActionBtn.vue";
import WorkspaceJobsPane from "./WorkspaceJobsPane.vue";
import { renderIconStr } from "../utils/render-icon.ts";
import { dirtyBadgeHtml } from "../utils/git.ts";
import { worktreeBranchLabel, workspaceDisplayName } from "../utils/worktree.ts";

// Open Session 一覧のワークスペース1行（WorkspaceOpen.vue から抽出）。
// 行のインライン Jobs 展開・worktree のネスト表示・Pull/Push/Changes バッジを持つ。
// 操作はすべて emit で親へ委譲する（並べ替え・API 呼び出しは親側の責務）。
const props = defineProps({
  ws: { type: Object as PropType<Record<string, any>>, required: true },
  inset: { type: Boolean, default: false },
  editMode: { type: Boolean, default: false },
  expandedWorkspace: { type: String as PropType<string | null>, default: null },
  worktrees: { type: Array as PropType<Record<string, any>[]>, default: () => [] },
  dragging: { type: Boolean, default: false },
  dragOffsetY: { type: Number, default: 0 },
  isRunning: { type: Function as PropType<(name: string, action: string) => boolean>, required: true },
});

defineEmits(["toggleJobs", "openChanges", "gitAction", "edit", "removeWorktree", "dragStart"]);

function pushActionFor(ws: Record<string, any>) {
  return ws.has_upstream === false ? "push-upstream" : "push";
}
</script>

<style scoped>
.picker-ws-group {
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  position: relative;
}

.picker-ws-group.dragging {
  opacity: 0.72;
  background: var(--bg-tertiary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 10;
}

.picker-ws-group-inset {
  border-bottom: none;
}

.picker-ws-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  user-select: none;
  -webkit-user-select: none;
}

.picker-ws-drag-handle {
  height: 100%;
}

.picker-ws-row-top {
  min-height: 44px;
  padding-bottom: 4px;
  box-sizing: border-box;
}

.picker-ws-header-label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

.picker-ws-header-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 1;
}

.picker-ws-name {
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.picker-ws-wt-icon {
  font-size: 13px;
  color: var(--accent);
  margin-right: 2px;
}

.picker-ws-worktrees {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 12px 8px 28px;
}

.picker-ws-jobs-chevron {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 16px;
  color: var(--text-muted);
}

.picker-ws-jobs-inline {
  margin: 0 12px 8px 28px;
  border-left: 2px solid var(--border);
  overflow: hidden;
}

.picker-ws-worktree-item {
  display: flex;
  align-items: center;
  border-left: 2px solid var(--border);
}

.picker-ws-worktree-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.picker-ws-worktree-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  min-width: 34px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--error);
  font-size: 16px;
  cursor: pointer;
}

.picker-ws-wt-child-icon {
  font-size: 13px;
  color: var(--accent);
  flex-shrink: 0;
}

.picker-ws-worktree-branch {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-ws-wt-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a623;
  flex-shrink: 0;
}

/* 行・ボタンの通常ホバー（背景/文字色）は base.css の .hover-bg /
   .hover-bg-text ユーティリティをテンプレート側で付ける。 */
@media (hover: hover) and (pointer: fine) {
  .picker-ws-worktree-del:hover {
    background: var(--error-bg-20, rgba(255, 85, 114, 0.15));
  }
}

.picker-ws-branch {
  max-width: 100%;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-ws-top-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.picker-ws-top-meta :deep(.git-badge) {
  height: 22px;
  min-height: 22px;
  max-height: 22px;
  min-width: auto;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1;
}

.picker-ws-top-meta :deep(.picker-ws-mini-btn),
.picker-ws-top-meta :deep(.git-action-btn) {
  height: 26px;
  min-height: 26px;
  max-height: 26px;
  min-width: 26px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1;
}

/* WorkspaceOpen.vue のグループヘッダー編集ボタンと同一スタイル（scoped のため両方で定義）。 */
.picker-ws-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  margin-left: 4px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

.picker-ws-mini-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-muted);
  cursor: pointer;
}

.git-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

button.git-badge:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-badge.dirty {
  color: var(--warning);
  background: var(--warning-bg-20);
  gap: 4px;
  font-size: 12px;
}
</style>
