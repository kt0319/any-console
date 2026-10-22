<template>
  <FileItem
    class="diff-file-row"
    :selected="selected"
    :label="file.path"
    :icon-html="renderFileIconFromPath(file.path)"
    @click="$emit('click', $event)"
  >
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
});

defineEmits(["click", "navigate"]);
</script>

<style scoped>
.diff-file-row-open {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  margin: 0 -8px 0 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
}
</style>
