<template>
  <span class="dispatch-queue-head-row">
    <span v-if="outcome" class="dispatch-queue-recent-head">
      <span v-if="!showDirectOnly" class="mdi" :class="outcomeIcon" role="img" :aria-label="outcome" :data-tooltip="outcome"></span>
      <span v-if="showDirectOnly && !badge" class="mdi mdi-flash-outline dispatch-queue-direct" role="img" aria-label="Direct run" data-tooltip="Direct run (no approval)"></span>
      <span v-else-if="badge" class="mdi dispatch-queue-report" :class="[REPORT_ICONS[badge.tone], `tone-${badge.tone}`]" role="img" :aria-label="badge.label" :data-tooltip="badge.label"></span>
      <span class="dispatch-queue-ws">{{ headLabel }}</span>
    </span>
    <span v-else-if="request.branch" class="dispatch-queue-ws">{{ request.branch }}</span>
    <span v-if="timeLabel" class="dispatch-queue-time" :data-tooltip="timeTooltip">
      <span class="mdi mdi-clock-outline"></span>{{ timeLabel }}
    </span>
  </span>
  <span v-if="auth" class="dispatch-queue-auth">{{ auth }}</span>
  <span v-if="request.text" class="dispatch-queue-text">{{ request.text }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { isDirectRun, reportBadge } from "../utils/dispatch-report.ts";
import { formatClockDateTime, formatMinutesAgo } from "../utils/format.ts";

// Dispatch Queue 一覧の1行分の本文（ブランチ名・テキスト）。ワークスペース詳細内
// のタブ（DispatchWorkspacePane.vue）で既にワークスペースが絞られているため、
// ワークスペース名・ジョブ名は表示しない。
// pending 行と履歴行で同じ表示ルールを共有する。
// outcome（executed/discarded/failed）がある時だけ先頭に結果アイコンを付け、アイコンの右にはブランチ → worktree → ジョブ名 → 結果ラベルの順で最初に取れたものを出す。

const props = defineProps({
  request: { type: Object, required: true },
  outcome: { type: String, default: "" },
  // direct スコープのトークンで実行された履歴項目の実行元（`direct:<トークン名>`）。
  auth: { type: String, default: "" },
  // 結果報告つきの履歴項目（報告の有無・検証結果・確認状態からバッジを導く）。
  item: { type: Object, default: null },
  // ジョブの表示用label（terminal等の既定ジョブや未解決の時は空文字）。
  jobLabel: { type: String, default: "" },
});

const REPORT_ICONS: Record<string, string> = {
  muted: "mdi-clipboard-clock-outline",
  ok: "mdi-clipboard-check-outline",
  warn: "mdi-clipboard-alert-outline",
  error: "mdi-clipboard-remove-outline",
};

const isDirect = computed(() => isDirectRun({ auth: props.auth }));
// direct の成功は結果のチェックを出さず、報告アイコン（報告対象外のときだけ雷）で示す。失敗・破棄は結果アイコン（失敗は赤）だけにして見落とさない。
const showDirectOnly = computed(() => isDirect.value && props.outcome === "executed");
const badge = computed(() => (props.item ? reportBadge(props.item) : null));

// pending行は受付時刻、決定済み行は決定時刻を「何分前」で表示する。
// hoverしたときだけ絶対時刻（日付込み）をtooltipで確認できるようにする。
const relevantAt = computed(() => {
  const decidedAt = props.request.decided_at;
  if (props.outcome && decidedAt != null) return decidedAt;
  return props.request.received_at;
});

const timeLabel = computed(() => formatMinutesAgo(relevantAt.value));

const OUTCOME_ICONS: Record<string, string> = {
  executed: "mdi-check-circle-outline",
  failed: "mdi-alert-circle-outline",
  discarded: "mdi-close-circle-outline",
};
const outcomeIcon = computed(() => OUTCOME_ICONS[props.outcome] || OUTCOME_ICONS.discarded);

const OUTCOME_LABELS: Record<string, string> = {
  executed: "Executed",
  failed: "Failed",
  discarded: "Discarded",
};
const outcomeLabel = computed(() => OUTCOME_LABELS[props.outcome] || OUTCOME_LABELS.discarded);

const headLabel = computed(() => props.request.branch || props.request.worktree || props.jobLabel || outcomeLabel.value);

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

.dispatch-queue-report {
  flex-shrink: 0;
  font-size: 15px;
  color: var(--text-muted);
}

.dispatch-queue-direct {
  flex-shrink: 0;
  font-size: 15px;
}

.dispatch-queue-auth {
  font-size: 12px;
  color: var(--text-muted);
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
  opacity: 0.6;
}

.dispatch-queue-recent-failed .dispatch-queue-recent-head .mdi {
  color: var(--error);
}

/* 行クラスの色（上の3つ）より優先させるため、head 配下で指定する。 */
.dispatch-queue-recent-head .mdi.dispatch-queue-direct { color: var(--warning); }
.dispatch-queue-recent-head .dispatch-queue-report.tone-ok { color: var(--success); }
.dispatch-queue-recent-head .dispatch-queue-report.tone-warn,
.dispatch-queue-recent-head .dispatch-queue-report.tone-muted { color: var(--warning); }
.dispatch-queue-recent-head .dispatch-queue-report.tone-error { color: var(--error); }
</style>
