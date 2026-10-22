<template>
  <div class="diff-file-browser-list">
    <ul v-for="file in files" :key="file.path" class="diff-file-box">
      <DiffFileItem
        :file="file"
        :selected="selectedFile === file.path"
        @click="toggleFile(file.path)"
      />
      <li v-if="isExpanded(file.path)" class="diff-file-open-row">
        <button type="button" class="diff-file-open-btn" @click="$emit('navigate', file)">
          <span class="mdi mdi-open-in-new" aria-hidden="true"></span>Open in Files
        </button>
      </li>
      <DiffInlineBody v-if="isExpanded(file.path)" :path="file.path" :status="file.status" :chunk="diffChunks[file.path]" />
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import DiffFileItem from "./DiffFileItem.vue";
import DiffInlineBody from "./DiffInlineBody.vue";

// ファイルごとに差分を展開表示するボックス一覧。Changes と History のコミット詳細で共用する。
// 行タップで開閉し、展開した先頭の行のボタンで Files タブへ移動（navigate）する。
const props = defineProps<{
  files: { path: string, status: string, numstat?: string }[],
  diffChunks: Record<string, string>,
  selectedFile?: string,
  defaultCollapsed?: boolean,
}>();

defineEmits<{ navigate: [file: { path: string, status: string }] }>();

// 既定の開閉状態から反転させたファイルだけを持つ
const toggledPaths = ref(new Set<string>());

function isExpanded(path: string) {
  return toggledPaths.value.has(path) === !!props.defaultCollapsed;
}

function toggleFile(path: string) {
  const next = new Set(toggledPaths.value);
  if (!next.delete(path)) next.add(path);
  toggledPaths.value = next;
}
</script>

<style scoped>
.diff-file-browser-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 6px;
}

.diff-file-open-row {
  list-style: none;
  display: flex;
  justify-content: flex-end;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
}

.diff-file-open-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
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
