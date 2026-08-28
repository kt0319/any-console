<template>
  <div v-if="totalHtml" class="diff-total-numstat">
    <span class="diff-file-row-numstat" v-html="totalHtml"></span>
    <span class="diff-file-row-status diff-total-numstat-spacer" aria-hidden="true">M</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { buildNumstatHtml } from "../utils/git.ts";

// ファイル一覧（DiffFileItem.vue、GitChanges.vue / GitHistory.vue で共用）の
// 合計挿入/削除行数を表示する。各ファイルのinsertions/deletionsは
// useGitDiff.tsのattachNumstatが解決済みの確定値（無情報時は0）を付けている
// ため、ここでは単純合計するだけでよい。
const props = defineProps({
  files: { type: Array as () => { insertions?: number, deletions?: number }[], default: () => [] },
});

const totalHtml = computed(() => {
  if (props.files.length === 0) return "";
  const insertions = props.files.reduce((sum, f) => sum + (f.insertions || 0), 0);
  const deletions = props.files.reduce((sum, f) => sum + (f.deletions || 0), 0);
  return buildNumstatHtml(insertions, deletions);
});
</script>

<style scoped>
/* ファイル一覧の各行（FileItem.vue .file-browser-item、padding: 0 8px）と
   numstatの縦位置（右端の揃え）が一致するよう、同じ横paddingにし、行末の
   ステータスバッジ（.diff-file-row-status、DiffFileItem.vue）と同じ形の
   非表示スペーサーを置く。.diff-file-row-numstatはmargin-left:autoを持つため、
   このコンテナ内でも同じロジックで右寄せされ、実際の行と幅がズレない。 */
.diff-total-numstat {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.diff-total-numstat-spacer {
  visibility: hidden;
}
</style>
