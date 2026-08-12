<template>
  <li class="session-sidebar-li" :class="rowStateClasses">
    <button
      type="button"
      class="session-sidebar-item hover-bg"
      :class="rowStateClasses"
      :aria-current="active ? 'true' : undefined"
      @click="emits('select')"
    >
      <SessionRowContent :item="item" />
    </button>
    <span
      ref="pillsRowEl"
      class="session-sidebar-pills-row"
      :class="rowStateClasses"
      @click="emits('select')"
    >
      <Transition name="pill-fade" mode="out-in">
        <PillPeek
          v-if="peekingKey"
          :key="peekingKey"
          :peeking-key="peekingKey"
          :color-class="peekColorClass"
          :icon-class="peekIconClass"
          :text="peekText"
          :signature="peekSignature"
          :tab="item.tab"
          :max-width="pillsMaxWidth"
          :changed-files="item.changedFiles"
          :insertions="item.insertions"
          :deletions="item.deletions"
          :branch-name="item.branch || ''"
          :ahead="item.ahead"
          :behind="item.behind"
          :push-count="branchPushCount"
          :pull-count="branchPullCount"
          :action-name="peekActionName"
          :action-status-text="peekActionStatusText"
          :peek-duration-ms="peekDurationMs"
          @peek-click="onPeekClick"
        />
        <InfoPillRow
          v-else
          key="normal"
          class="session-sidebar-pills"
          :tab="item.tab"
          :max-width="pillsMaxWidth"
          :is-git-repo="item.isGitRepo"
          :is-dirty="item.dirty"
          :ahead="item.ahead"
          :behind="item.behind"
          :has-pr="item.hasPr"
          :has-action="item.hasAction"
          :has-dev-server="item.hasDevServer"
          :dispatch-count="item.dispatchCount"
          :action-status-class="item.actionStatusClass"
          :action-status-icon="item.actionStatusIcon"
          :tooltips="item.tooltips"
          @open="emits('pillOpen', $event)"
        />
      </Transition>
      <button
        v-if="!peekingKey"
        type="button"
        class="pill-close-btn pill-tab-close-btn"
        aria-label="Close tab"
        data-tooltip="Close tab"
        @click.stop="emits('closeTab')"
      ><span class="mdi mdi-close"></span></button>
    </span>
  </li>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import SessionRowContent from "./SessionRowContent.vue";
import InfoPillRow from "./InfoPillRow.vue";
import PillPeek from "./PillPeek.vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";
import { usePillPeek } from "../composables/usePillPeek.js";
import { buildTrailingPeekItems } from "../utils/pill-peek.js";
import { SIDEBAR_PILL_ROW_RESERVED_PX } from "../utils/constants.js";

// SessionListView.vueの1行分（本体ボタン＋ピル行）。行ごとに独立したpeek状態
// （usePillPeek）を持たせるため、TerminalPaneの浮遊ピルと同じ「値が変化したら
// 数秒だけ長いピル(PillPeek)を出す」演出を独立コンポーネントとして切り出した
// （usePillPeekはVueのcomposable規約上、コンポーネントのsetup()で1回だけ
// 呼ぶ必要があり、SessionListView.vue側のv-forループ内では呼べないため）。
const props = defineProps({
  item: { type: Object, required: true },
  active: { type: Boolean, default: false },
  prsByWorkspace: { type: Object, default: () => ({}) },
  runsByWorkspace: { type: Object, default: () => ({}) },
});

const emits = defineEmits(["select", "pillOpen", "closeTab"]);

const infoPillConfig = useInfoPillConfigStore();

const rowStateClasses = computed(() => ({
  active: props.active,
  "session-working": props.item.agent?.className === "agent-state-working",
  "session-blocked": props.item.agent?.className === "agent-state-blocked",
  "session-phrase-notify": !!props.item.phraseNotify,
}));

// TerminalPane.vue（trailingMaxWidth）と同じ考え方: 閉じるボタン＋余白ぶんを
// 差し引いた残りをpeekピル/InfoPillRowの上限幅にする。
const pillsRowEl = ref(null);
const pillsRowWidth = ref(0);
const pillsMaxWidth = computed(() => Math.max(0, pillsRowWidth.value - SIDEBAR_PILL_ROW_RESERVED_PX));
let roPillsRow = null;
watch(pillsRowEl, (el) => {
  roPillsRow?.disconnect();
  roPillsRow = null;
  if (!el) return;
  roPillsRow = new ResizeObserver((entries) => {
    for (const e of entries) pillsRowWidth.value = e.contentRect.width;
  });
  roPillsRow.observe(el);
});
// template refのwatchはアンマウント時には再発火しない（scope停止が先）ため、
// TerminalPane.vueのroPaneと同様に明示的に解放する。
onBeforeUnmount(() => {
  roPillsRow?.disconnect();
  roPillsRow = null;
});

const peekFields = computed(() => ({
  workspaceLabel: props.item.tab.workspace || props.item.tab.label || "",
  isGitRepo: props.item.isGitRepo,
  hasSession: !!props.item.tab.sessionId,
  hasWorkspace: !!props.item.tab.workspace,
  isDirty: props.item.dirty,
  changedFiles: props.item.changedFiles,
  insertions: props.item.insertions,
  deletions: props.item.deletions,
  branch: props.item.branch || "",
  ahead: props.item.ahead,
  behind: props.item.behind,
  lastCommitMessage: props.item.lastCommitMessage,
  branchPR: props.item.branchPR,
  branchAction: props.item.branchAction,
  devServerEntry: props.item.devServerEntry,
  dispatchItems: props.item.dispatchItems,
  dispatchTooltip: props.item.tooltips?.dispatch,
}));

const trailingPeekItems = computed(() => buildTrailingPeekItems(peekFields.value, infoPillConfig));

// peekピル表示用の派生値（アイコン・色・テキスト・シグネチャ）も
// usePillPeekが返す（TerminalPaneと共用）。
const {
  peekingKey,
  peekDurationMs,
  branchPushCount,
  branchPullCount,
  peekIconClass,
  peekColorClass,
  peekText,
  peekSignature,
  peekActionName,
  peekActionStatusText,
} = usePillPeek({
  trailingPeekItems,
  // TerminalPane.vueのpaneWorkspace（tab.workspaceがあっても
  // workspaceStore側で未解決ならundefined）と同じ形にする。usePillPeekは
  // これの有無・last_commit_messageの有無で初回誤検知を防いでいる。
  paneWorkspace: computed(() => (
    props.item.tab.workspace && props.item.wsResolved
      ? { last_commit_message: props.item.lastCommitMessage }
      : undefined
  )),
  workspaceKey: () => props.item.tab.workspace,
  prsByWorkspace: computed(() => props.prsByWorkspace),
  runsByWorkspace: computed(() => props.runsByWorkspace),
  devServerEntry: computed(() => props.item.devServerEntry),
  ahead: computed(() => props.item.ahead),
  behind: computed(() => props.item.behind),
  peekFields,
});

function onPeekClick() {
  emits("pillOpen", peekingKey.value);
}
</script>
