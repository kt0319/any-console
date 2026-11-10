<template>
  <section class="dispatch-report" aria-label="Dispatch result">
    <div class="dispatch-report-states">
      <span class="dispatch-report-chip">Launch: {{ item.outcome }}</span>
      <span v-if="agentState" class="dispatch-report-chip">Agent: {{ agentState }}</span>
      <span class="dispatch-report-chip" :class="`tone-${reportTone}`">{{ reportLabel }}</span>
      <span v-if="state === 'reported'" class="dispatch-report-chip" :class="`tone-${verificationToneClass}`">{{ verificationLabel }}</span>
    </div>

    <p v-if="state === 'unreported'" class="dispatch-report-note">The agent has not reported a result. Being idle or finished does not mean the work is complete or verified.</p>

    <template v-if="submitted">
      <dl class="dispatch-report-block">
        <dt>Summary <span class="dispatch-report-note">(reported by the agent: {{ submitted.status }})</span></dt>
        <dd class="dispatch-report-text">{{ submitted.summary }}</dd>
      </dl>
      <dl v-if="submitted.changes?.length" class="dispatch-report-block">
        <dt>Changes</dt>
        <dd><ul><li v-for="(line, i) in submitted.changes" :key="i">{{ line }}</li></ul></dd>
      </dl>
      <dl class="dispatch-report-block">
        <dt>Verification <span class="dispatch-report-note">(reported by the agent, not checked by the server)</span></dt>
        <dd>
          <p v-if="!submitted.verifications?.length" class="dispatch-report-note">No verification was reported.</p>
          <ul v-else>
            <li v-for="(v, i) in submitted.verifications" :key="i" :class="`result-${v.result}`">
              <span class="mdi" :class="RESULT_ICONS[v.result] || RESULT_ICONS.unknown" aria-hidden="true"></span>
              <strong>{{ v.result }}</strong> {{ v.name }}<span v-if="v.detail"> — {{ v.detail }}</span>
            </li>
          </ul>
        </dd>
      </dl>
      <dl v-if="submitted.open_issues?.length" class="dispatch-report-block">
        <dt>Open issues</dt>
        <dd><ul><li v-for="(line, i) in submitted.open_issues" :key="i">{{ line }}</li></ul></dd>
      </dl>
      <dl v-if="submitted.decisions_needed?.length" class="dispatch-report-block">
        <dt>Needs your decision</dt>
        <dd><ul><li v-for="(line, i) in submitted.decisions_needed" :key="i">{{ line }}</li></ul></dd>
      </dl>
      <dl v-if="hasArtifacts" class="dispatch-report-block">
        <dt>Artifacts <span class="dispatch-report-note">(existence checked by the server)</span></dt>
        <dd>
          <ul>
            <li v-for="commit in submitted.artifacts.commits" :key="commit">
              commit <code>{{ commit }}</code> — {{ CHECK_LABELS[commitCheck(item, commit)] }}
            </li>
            <li v-if="submitted.artifacts.branch">branch <code>{{ submitted.artifacts.branch }}</code> — {{ CHECK_LABELS[branchCheck(item)] }}</li>
            <li v-if="submitted.artifacts.preview_port">preview port {{ submitted.artifacts.preview_port }}</li>
          </ul>
        </dd>
      </dl>
    </template>

    <div class="dispatch-report-actions">
      <button v-if="previewUrl" type="button" @click="emits('open-preview', previewUrl)">
        <span class="mdi mdi-open-in-new"></span> Open preview
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, type PropType } from "vue";
import { useAgentStateStore } from "../stores/agent-state.ts";
import {
  branchCheck,
  commitCheck,
  previewProxyPort,
  reportBadge,
  reportState,
  verificationTone,
  verificationCounts,
  type DispatchReportItem,
} from "../utils/dispatch-report.ts";

// Dispatch 履歴項目の詳細に出す結果カード。報告本文はエージェントが書いた信頼できない
// 入力なので、すべて文字列補間のみで表示する（v-html を使わない）。

const props = defineProps({
  item: { type: Object as PropType<DispatchReportItem & Record<string, any>>, required: true },
});
const emits = defineEmits<{
  (e: "open-preview", url: string): void;
}>();

const RESULT_ICONS: Record<string, string> = {
  passed: "mdi-check-circle-outline",
  failed: "mdi-close-circle-outline",
  skipped: "mdi-minus-circle-outline",
  unknown: "mdi-help-circle-outline",
};
const CHECK_LABELS = { found: "found", missing: "not found", unknown: "could not check" };

const agentStates = useAgentStateStore().agentStates;
const agentState = computed(() => (props.item.session_id ? agentStates[props.item.session_id] || "" : ""));

const state = computed(() => reportState(props.item));
const submitted = computed(() => props.item.report?.submitted as Record<string, any> | undefined);
const badge = computed(() => reportBadge(props.item));
const reportLabel = computed(() => {
  if (state.value === "unreported") return "Result not reported";
  return badge.value?.label || "Reported";
});
const reportTone = computed(() => badge.value?.tone || "muted");

const verificationToneClass = computed(() => {
  const tone = verificationTone(props.item);
  return tone === "passed" ? "ok" : tone === "failed" ? "error" : "warn";
});
const verificationLabel = computed(() => {
  const tone = verificationTone(props.item);
  if (tone === "none") return "No verification reported";
  const c = verificationCounts(props.item);
  return `Verification: ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped, ${c.unknown} unknown`;
});

const hasArtifacts = computed(() => {
  const a = submitted.value?.artifacts;
  return !!(a && (a.commits?.length || a.branch || a.preview_port));
});

const previewUrl = computed(() => {
  const port = previewProxyPort(submitted.value?.artifacts?.preview_port);
  return port ? `${location.protocol}//${location.hostname}:${port}/` : "";
});
</script>

<style scoped>
.dispatch-report {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 4px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}

.dispatch-report-states {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dispatch-report-chip {
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text-secondary);
}

.dispatch-report-chip.tone-ok { color: var(--success); border-color: var(--success); }
.dispatch-report-chip.tone-warn { color: var(--warning); border-color: var(--warning); }
.dispatch-report-chip.tone-error { color: var(--error); border-color: var(--error); }

.dispatch-report-block { margin: 0; }
.dispatch-report-block dt { font-size: 11px; font-weight: 600; color: var(--text-muted); }
.dispatch-report-block dd { margin: 2px 0 0; font-size: 13px; }
.dispatch-report-block ul { margin: 0; padding-left: 18px; }
.dispatch-report-text { white-space: pre-wrap; word-break: break-word; }
.dispatch-report-note { margin: 0; font-size: 12px; font-weight: 400; color: var(--text-muted); }

.result-failed strong { color: var(--error); }
.result-passed strong { color: var(--success); }
.result-skipped strong, .result-unknown strong { color: var(--warning); }

.dispatch-report-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dispatch-report-actions button {
  min-height: 44px;
}
</style>
