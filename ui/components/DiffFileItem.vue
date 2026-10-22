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
      ><span :class="['mdi', expanded ? 'mdi-chevron-down' : 'mdi-chevron-right']" aria-hidden="true"></span></button>
    </template>
    <template #right>
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
import { diffStatusClass, diffStatusLabel } from "../utils/git.ts";

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
});

defineEmits(["click", "navigate"]);
</script>

<style scoped>
.diff-file-row-toggle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  min-height: 24px;
  margin: 0 -4px 0 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
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
