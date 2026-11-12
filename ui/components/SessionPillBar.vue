<template>
  <div ref="rootEl" class="session-pill-bar">
    <SessionRowMeta :item="item" :compact="compact" />
    <span class="session-sidebar-pills-row">
      <Transition name="pill-fade" mode="out-in">
        <PillPeek
          v-if="peek.peekingKey.value"
          :key="peek.peekingKey.value"
          :peeking-key="peek.peekingKey.value"
          :color-class="peek.peekColorClass.value"
          :icon-class="peek.peekIconClass.value"
          :text="peek.peekText.value"
          :signature="peek.peekSignature.value"
          :tab="tab"
          :max-width="pillsMaxWidth"
          :insertions="item.insertions"
          :deletions="item.deletions"
          :status-counts="item.statusCounts"
          :branch-name="item.branch || ''"
          :ahead="item.ahead"
          :behind="item.behind"
          :push-count="peek.branchPushCount.value"
          :pull-count="peek.branchPullCount.value"
          :remote-result="peek.branchRemoteResult.value"
          :action-name="peek.peekActionName.value"
          :action-status-text="peek.peekActionStatusText.value"
          :peek-duration-ms="peek.peekDurationMs.value"
          @peek-click="emits('open', peek.peekingKey.value)"
        />
        <InfoPillRow
          v-else
          key="normal"
          class="session-sidebar-pills"
          :tab="tab"
          :max-width="pillsMaxWidth"
          v-bind="buildInfoPillRowProps(item as PillFields, item.isWorktree)"
          @open="emits('open', $event)"
        />
      </Transition>
      <slot v-if="!peek.peekingKey.value" name="actions"></slot>
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, type PropType } from "vue";
import SessionRowMeta from "./SessionRowMeta.vue";
import InfoPillRow from "./InfoPillRow.vue";
import PillPeek from "./PillPeek.vue";
import { useElementMaxWidth } from "../composables/useElementMaxWidth.ts";
import type { usePeekPills } from "../composables/usePeekPills.ts";
import { buildInfoPillRowProps, type PillFields } from "../utils/pill-fields.ts";
import { SIDEBAR_PILL_ROW_RESERVED_PX } from "../utils/constants.ts";

// 左に「状態アイコン + ブランチ名」、右にピル（値が変わった時だけ peek に差し替わる）と
// 操作ボタンを並べる帯。サイドバーの行2（SessionSidebarRow.vue）とターミナルペインの
// バー表示（TerminalPane.vue）で共用する。peek の状態は呼び出し側の usePeekPills を受け取る。
defineProps({
  item: { type: Object, required: true },
  tab: { type: Object, required: true },
  peek: { type: Object as PropType<ReturnType<typeof usePeekPills>>, required: true },
  compact: { type: Boolean, default: false },
});

const emits = defineEmits(["open"]);

// 基準は帯自身の実幅。pills-row 自身（中身で伸縮する）を基準にすると、maxWidth で
// 中身が決まり中身で maxWidth が決まる循環になり 0 に収束するため使わない。
const rootEl = ref<HTMLElement | null>(null);
const { maxWidth: pillsMaxWidth } = useElementMaxWidth(rootEl, SIDEBAR_PILL_ROW_RESERVED_PX, true);
</script>

<style scoped>
.session-pill-bar {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
</style>
