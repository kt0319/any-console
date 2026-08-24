<template>
  <span class="dispatch-queue-head-row">
    <span v-if="outcome" class="dispatch-queue-recent-head">
      <span class="mdi" :class="outcome === 'executed' ? 'mdi-check-circle-outline' : 'mdi-close-circle-outline'"></span>
      <span v-if="request.branch" class="dispatch-queue-ws">{{ request.branch }}</span>
    </span>
    <span v-else-if="request.branch" class="dispatch-queue-ws">{{ request.branch }}</span>
    <span v-if="timeLabel" class="dispatch-queue-time" :data-tooltip="timeTooltip">
      <span class="mdi mdi-clock-outline"></span>{{ timeLabel }}
    </span>
  </span>
  <span v-if="request.text" class="dispatch-queue-text">{{ request.text }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatClockDateTime, formatMinutesAgo } from "../utils/format.ts";

// Dispatch Queue 一覧の1行分の本文（ブランチ名・テキスト）。ワークスペース詳細内
// のタブ（DispatchWorkspacePane.vue）で既にワークスペースが絞られているため、
// ワークスペース名・ジョブ名は表示しない。
// pending 行と Recently executed 行で同じ表示ルールを共有する。
// outcome（executed/decided）がある時だけ先頭に結果アイコンを付ける。

const props = defineProps({
  request: { type: Object, required: true },
  outcome: { type: String, default: "" },
});

// pending行は受付時刻、決定済み行は決定時刻を「何分前」で表示する。
// hoverしたときだけ絶対時刻（日付込み）をtooltipで確認できるようにする。
const relevantAt = computed(() => {
  const decidedAt = props.request.decided_at;
  if (props.outcome && decidedAt != null) return decidedAt;
  return props.request.received_at;
});

const timeLabel = computed(() => formatMinutesAgo(relevantAt.value));

const timeTooltip = computed(() => {
  const label = props.outcome ? "Decided at" : "Received at";
  const absolute = formatClockDateTime(relevantAt.value);
  return absolute ? `${label}: ${absolute}` : label;
});
</script>

<style scoped>
.dispatch-queue-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.dispatch-queue-ws {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.dispatch-queue-time {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
  font-size: 12px;
  color: var(--text-muted);
}

.dispatch-queue-time .mdi {
  font-size: 12px;
}

.dispatch-queue-text {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.dispatch-queue-recent-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 実行/破棄の色は親（DispatchWorkspacePane.vue）の行クラスに応じて変える。 */
.dispatch-queue-recent-executed .dispatch-queue-recent-head .mdi {
  color: var(--success);
}

.dispatch-queue-recent-discarded .dispatch-queue-recent-head .mdi {
  color: var(--text-muted);
}
</style>
