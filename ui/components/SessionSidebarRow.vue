<template>
  <li class="session-sidebar-li" :class="rowStateClasses">
    <span ref="row1El" class="session-sidebar-row1" :class="rowStateClasses" @click="emits('select')">
      <button
        type="button"
        class="session-sidebar-item"
        :aria-current="active ? 'true' : undefined"
      >
        <SessionRowContent :item="item" />
      </button>
      <span class="session-sidebar-pills-row">
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
          :is-worktree="item.isWorktree"
          :is-dirty="item.dirty"
          :ahead="item.ahead"
          :behind="item.behind"
          :has-pr="item.hasPr"
          :has-action="item.hasAction"
          :has-dev-server="item.hasDevServer"
          :dispatch-count="item.dispatchCount"
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
    </span>
    <span v-if="item.branch || item.agent" class="session-sidebar-row2" :class="rowStateClasses" @click="emits('select')">
      <SessionRowMeta :item="item" />
    </span>
  </li>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import SessionRowContent from "./SessionRowContent.vue";
import SessionRowMeta from "./SessionRowMeta.vue";
import InfoPillRow from "./InfoPillRow.vue";
import PillPeek from "./PillPeek.vue";
import { usePeekPills } from "../composables/usePeekPills.ts";
import { useElementMaxWidth } from "../composables/useElementMaxWidth.ts";
import { SIDEBAR_PILL_ROW_RESERVED_PX } from "../utils/constants.ts";

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


const rowStateClasses = computed(() => ({
  active: props.active,
  "session-working": props.item.agent?.className === "agent-state-working",
  "session-blocked": props.item.agent?.className === "agent-state-blocked",
  "session-phrase-notify": !!props.item.phraseNotify,
}));

// TerminalPane.vue（trailingMaxWidth）と同じ考え方: 行1（.session-sidebar-row1、
// 常に行全体の実幅を持つ安定した基準）から閉じるボタン＋余白ぶんを
// 差し引いた残りをpeekピル/InfoPillRowの上限幅にする。
// pills-row自身（中身に応じて伸縮する）を基準にすると、maxWidthで中身が
// 決まり中身でmaxWidthが決まる循環参照になり0に収束してしまうため使わない。
const row1El = ref<HTMLElement | null>(null);
const { maxWidth: pillsMaxWidth } = useElementMaxWidth(row1El, SIDEBAR_PILL_ROW_RESERVED_PX);

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

// trailingPeekItems の組み立てと peek 派生値の算出は usePeekPills に集約
//（TerminalPane と共用）。
const {
  trailingPeekItems,
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
} = usePeekPills({
  peekFields,
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
});

function onPeekClick() {
  emits("pillOpen", peekingKey.value);
}
</script>
