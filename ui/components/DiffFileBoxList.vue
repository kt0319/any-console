<template>
  <div class="diff-file-browser-list">
    <ul v-for="file in files" :key="file.path" class="diff-file-box">
      <DiffFileItem
        :file="file"
        :selected="selectedFile === file.path"
        :expanded="!collapsedPaths.has(file.path)"
        navigable
        @click="toggleFile(file.path)"
        @navigate="$emit('navigate', file)"
      />
      <DiffInlineBody v-if="!collapsedPaths.has(file.path)" :path="file.path" :status="file.status" />
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import DiffFileItem from "./DiffFileItem.vue";
import DiffInlineBody from "./DiffInlineBody.vue";

// ファイルごとに差分を展開表示するボックス一覧。Changes と History のコミット詳細で共用する。
// 行タップで開閉し、右端のボタンで Files タブへ移動（navigate）する。
defineProps<{
  files: { path: string, status: string, numstat?: string }[],
  selectedFile?: string,
}>();

defineEmits<{ navigate: [file: { path: string, status: string }] }>();

const collapsedPaths = ref(new Set<string>());

function toggleFile(path: string) {
  const next = new Set(collapsedPaths.value);
  if (!next.delete(path)) next.add(path);
  collapsedPaths.value = next;
}
</script>

<style scoped>
.diff-file-browser-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 10px;
}

.diff-file-box {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
</style>
