<template>
  <span v-if="outcome" class="dispatch-queue-recent-head">
    <span class="mdi" :class="outcome === 'executed' ? 'mdi-check-circle-outline' : 'mdi-close-circle-outline'"></span>
    <span class="dispatch-queue-ws">{{ dispatchWorkspaceLabel(request) }}</span>
  </span>
  <span v-else class="dispatch-queue-ws">{{ dispatchWorkspaceLabel(request) }}</span>
  <span class="dispatch-queue-meta">
    <span v-if="dispatchJobLabel(request)">{{ dispatchJobLabel(request) }}</span>
    <span v-if="request.branch">{{ request.branch }}</span>
    <span v-if="timeLabel" class="dispatch-queue-time" :data-tooltip="timeTooltip">
      <span class="mdi mdi-clock-outline"></span>{{ timeLabel }}
    </span>
  </span>
  <span v-if="request.text" class="dispatch-queue-text">{{ request.text }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { dispatchWorkspaceLabel, dispatchJobLabel } from "../utils/dispatch-request.ts";
import { formatClockTime, formatDuration } from "../utils/format.ts";

// Dispatch Queue 一覧の1行分の本文（ワークスペース名・ジョブ/ブランチ・テキスト）。
// pending 行と Recently executed 行で同じ表示ルールを共有する。
// outcome（executed/decided）がある時だけ先頭に結果アイコンを付ける。

const props = defineProps({
  request: { type: Object, required: true },
  outcome: { type: String, default: "" },
});

// pending行は受付時刻（受付からの経過は待ち時間として実行/破棄後に確定する
// ため、pending中は時刻のみ表示）。決定済み行は決定時刻＋受付からの
// 待ち時間（実行/破棄までにキューで待たされた時間）を表示する。
const timeLabel = computed(() => {
  const receivedAt = props.request.received_at;
  const decidedAt = props.request.decided_at;
  if (props.outcome && decidedAt != null) {
    const waited = receivedAt != null ? formatDuration(decidedAt - receivedAt) : "";
    return waited ? `${formatClockTime(decidedAt)} (waited ${waited})` : formatClockTime(decidedAt);
  }
  return formatClockTime(receivedAt);
});

const timeTooltip = computed(() => (props.outcome ? "Decided at" : "Received at"));
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

.dispatch-queue-time {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.dispatch-queue-time .mdi {
  font-size: 12px;
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

/* 実行/破棄の色は親（DispatchWorkspacePane.vue）の行クラスに応じて変える。 */
.dispatch-queue-recent-executed .dispatch-queue-recent-head .mdi {
  color: var(--success);
}

.dispatch-queue-recent-discarded .dispatch-queue-recent-head .mdi {
  color: var(--text-muted);
}
</style>
