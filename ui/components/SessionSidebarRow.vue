<template>
  <li class="session-sidebar-li" :class="[rowStateClasses, { 'session-group': item.inGroup, 'session-group-last': item.groupLast, 'session-compact': item.compact }]">
    <span v-if="!item.compact" class="session-sidebar-row1" :class="rowStateClasses" @click="emits('select')">
      <button
        type="button"
        class="session-sidebar-item"
        :aria-current="active ? 'true' : undefined"
      >
        <SessionRowContent :item="item" />
      </button>
    </span>
    <span class="session-sidebar-row2" :class="rowStateClasses" @click="emits('select')">
      <SessionPillBar :item="item" :tab="item.tab" :peek="peek" :compact="item.compact" @open="emits('pillOpen', $event)">
        <template #actions>
          <button
            type="button"
            class="pill-close-btn pill-tab-close-btn"
            aria-label="Close tab"
            data-tooltip="Close tab"
            @click.stop="emits('closeTab')"
          ><span class="mdi mdi-close"></span></button>
        </template>
      </SessionPillBar>
    </span>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";
import SessionRowContent from "./SessionRowContent.vue";
import SessionPillBar from "./SessionPillBar.vue";
import { usePeekPills } from "../composables/usePeekPills.ts";
import { buildPeekFields, type PillFields } from "../utils/pill-fields.ts";

// usePillPeek は setup() で1回だけ呼ぶ必要があり SessionListView の v-for 内では呼べないため、行を別コンポーネントにしている。
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

const peekFields = computed(() => buildPeekFields(props.item.tab, props.item as PillFields));

const peek = usePeekPills({
  peekFields,
  // workspaceStore で未解決なら undefined（初回誤検知防止のため TerminalPane.paneWorkspace と同じ形）
  paneWorkspace: computed(() => (
    props.item.tab.workspace && props.item.wsResolved
      ? { last_commit_message: props.item.lastCommitMessage }
      : undefined
  )),
  sessionId: () => props.item.tab.sessionId,
  workspaceKey: () => props.item.tab.workspace,
  prsByWorkspace: computed(() => props.prsByWorkspace),
  runsByWorkspace: computed(() => props.runsByWorkspace),
  devServerEntry: computed(() => props.item.devServerEntry),
  ahead: computed(() => props.item.ahead),
  behind: computed(() => props.item.behind),
});

</script>
