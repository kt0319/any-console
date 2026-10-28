<template>
  <div class="diff-file-browser-list">
    <ul v-for="file in files" :key="file.path" class="diff-file-box">
      <DiffFileItem
        :file="file"
        navigable
        :expanded="isExpanded(file.path)"
        :resolvable="resolvable"
        @click="toggleFile(file.path)"
        @navigate="$emit('navigate', file)"
        @resolve="$emit('resolve', file)"
      />
      <DiffInlineBody v-if="isExpanded(file.path)" :path="file.path" :chunk="diffChunks[file.path]" :content="newFileContents?.[file.path]" />
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DiffFileItem from "./DiffFileItem.vue";
import DiffInlineBody from "./DiffInlineBody.vue";

// ファイルごとに差分を展開表示するボックス一覧。Changes と History のコミット詳細で共用する。
// 行タップで開閉し、右端のボタンで Files タブへ移動（navigate）する。
const props = defineProps<{
  files: { path: string, status: string, numstat?: string }[],
  diffChunks: Record<string, string>,
  newFileContents?: Record<string, Record<string, any>>,
  defaultCollapsed?: boolean,
  resolvable?: boolean,
}>();

defineEmits<{
  navigate: [file: { path: string, status: string }],
  resolve: [file: { path: string, status: string }],
}>();

// 既定の開閉状態から反転させたファイルだけを持つ
const toggledPaths = ref(new Set<string>());

function isExpanded(path: string) {
  return toggledPaths.value.has(path) === !!props.defaultCollapsed;
}

watch(() => props.files, (files) => {
  const remaining = new Set(files.map((f) => f.path));
  const kept = [...toggledPaths.value].filter((path) => remaining.has(path));
  if (kept.length !== toggledPaths.value.size) toggledPaths.value = new Set(kept);
});

// toggledPaths は「既定の開閉から反転したファイル」なので、既定が閉じなら全開は全パス、既定が開なら全開は空集合になる。
function setAllExpanded(expanded: boolean) {
  const flipsFromDefault = expanded === !!props.defaultCollapsed;
  toggledPaths.value = new Set(flipsFromDefault ? props.files.map((f) => f.path) : []);
}

const allExpanded = computed(() => props.files.every((f) => isExpanded(f.path)));

defineExpose({
  allExpanded,
  toggleAll: () => setAllExpanded(!allExpanded.value),
});

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
  padding: 4px 2px;
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
