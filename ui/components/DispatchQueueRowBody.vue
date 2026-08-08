<template>
  <span v-if="decision" class="dispatch-queue-recent-head">
    <span class="mdi" :class="decision === 'approved' ? 'mdi-check-circle-outline' : 'mdi-close-circle-outline'"></span>
    <span class="dispatch-queue-ws">{{ dispatchWorkspaceLabel(request) }}</span>
  </span>
  <span v-else class="dispatch-queue-ws">{{ dispatchWorkspaceLabel(request) }}</span>
  <span class="dispatch-queue-meta">
    <span v-if="dispatchJobLabel(request)">{{ dispatchJobLabel(request) }}</span>
    <span v-if="request.branch">{{ request.branch }}</span>
  </span>
  <span v-if="request.text" class="dispatch-queue-text">{{ request.text }}</span>
</template>

<script setup>
import { dispatchWorkspaceLabel, dispatchJobLabel } from "../utils/dispatch-request.js";

// Dispatch Queue 一覧の1行分の本文（ワークスペース名・ジョブ/ブランチ・テキスト）。
// pending 行と Recently executed 行で同じ表示ルールを共有する。
// decision（approved/rejected）がある時だけ先頭に決定アイコンを付ける。

defineProps({
  request: { type: Object, required: true },
  decision: { type: String, default: "" },
});
</script>

<style scoped>
.dispatch-queue-ws {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dispatch-queue-meta {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.dispatch-queue-text {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dispatch-queue-recent-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 承認/却下の色は親（DispatchWorkspacePane.vue）の行クラスに応じて変える。 */
.dispatch-queue-recent-approved .dispatch-queue-recent-head .mdi {
  color: var(--success);
}

.dispatch-queue-recent-rejected .dispatch-queue-recent-head .mdi {
  color: var(--text-muted);
}
</style>
