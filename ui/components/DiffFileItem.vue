<template>
  <FileItem
    class="diff-file-row"
    :selected="selected"
    :label="file.path"
    :icon-html="renderFileIconFromPath(file.path)"
    @click="$emit('click', $event)"
  >
    <template #right>
      <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
      <span :class="['diff-file-row-status', diffStatusClass(file.status)]">{{ file.status }}</span>
    </template>
  </FileItem>
</template>

<script setup lang="ts">
import type { PropType } from "vue";
import FileItem from "./FileItem.vue";
import { renderFileIconFromPath } from "../utils/file-icon.ts";
import { diffStatusClass } from "../utils/git.ts";

// 差分ファイル一覧の1行（numstat + ステータスバッジ付き）。
// Changes（GitChanges.vue）と History のコミットファイル一覧（GitHistory.vue）で共用する。
defineProps({
  file: {
    type: Object as PropType<{ path: string, status: string, numstat?: string }>,
    required: true,
  },
  selected: { type: Boolean, default: false },
});

defineEmits(["click"]);
</script>
