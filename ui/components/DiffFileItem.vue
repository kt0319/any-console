<template>
  <FileItem
    class="diff-file-row"
    :selected="selected"
    :label="file.path"
    :icon-html="renderFileIconFromPath(file.path)"
    @click="$emit('click', $event)"
  >
    <template v-if="expanded !== undefined" #left>
      <button
        type="button"
        class="diff-file-row-toggle"
        :aria-expanded="expanded"
        :aria-label="expanded ? 'Collapse diff' : 'Expand diff'"
        @click.stop="$emit('click', $event)"
      ></button>
    </template>
    <template #right>
      <button
        v-if="resolvable && isUnmergedDiffStatus(file.status)"
        type="button"
        class="diff-file-row-resolve"
        @click.stop="$emit('resolve')"
      ><span class="mdi mdi-check" aria-hidden="true"></span>Mark resolved</button>
      <span class="diff-file-row-meta">
        <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
        <span :class="['diff-file-row-status', diffStatusClass(file.status)]">{{ diffStatusLabel(file.status) }}</span>
      </span>
      <button
        v-if="navigable"
        type="button"
        class="diff-file-row-open"
        aria-label="Open in Files"
        data-tooltip="Open in Files"
        @click.stop="$emit('navigate')"
      ><span class="mdi mdi-open-in-new" aria-hidden="true"></span></button>
    </template>
  </FileItem>
</template>

<script setup lang="ts">
import type { PropType } from "vue";
import FileItem from "./FileItem.vue";
import { renderFileIconFromPath } from "../utils/file-icon.ts";
import { diffStatusClass, diffStatusLabel, isUnmergedDiffStatus } from "../utils/git.ts";

// 差分ファイル一覧の1行（numstat + ステータスバッジ付き）。
// Changes（GitChanges.vue）と History のコミットファイル一覧（GitHistory.vue）で共用する。
defineProps({
  file: {
    type: Object as PropType<{ path: string, status: string, numstat?: string }>,
    required: true,
  },
  selected: { type: Boolean, default: false },
  navigable: { type: Boolean, default: false },
  expanded: { type: Boolean, default: undefined },
  // コンフリクト中のファイルに「Mark resolved」を出す（Changes のみ。History のコミット詳細では出さない）
  resolvable: { type: Boolean, default: false },
});

defineEmits(["click", "navigate", "resolve"]);
</script>

<style scoped>
.diff-file-row-toggle {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
}

.diff-file-row:has(.diff-file-row-toggle:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.diff-file-row-resolve {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-height: 24px;
  padding: 0 8px;
  font-size: 11px;
  border-radius: 999px;
  border: 1px solid var(--warning);
  background: var(--warning-bg-20);
  color: var(--warning);
  cursor: pointer;
}

.diff-file-row-open {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  min-height: 32px;
  margin: 0 -8px 0 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
}

.diff-file-row-open::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
}
</style>
