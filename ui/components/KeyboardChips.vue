<template>
  <div class="quick-snippet-row">
    <div class="quick-snippet-scroll-row">
      <div
        v-for="(item, idx) in items"
        :key="mode + '-' + idx"
        class="quick-chip-item"
        @touchstart="onItemTouchStart($event, item, idx)"
        @touchmove="onTouchMove($event)"
        @touchend="onChipTouchEnd($event, item.command)"
        @touchcancel="onTouchCancel"
      >
        {{ isHistory ? item.command : truncateQuickText(item.command) }}
      </div>
      <div v-if="items.length === 0" class="quick-chip-item quick-chip-item-empty">{{ emptyLabel }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useQuickInputData } from "../composables/useQuickInputData.js";
import { useInputStore } from "../stores/input.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmIrreversible } from "../utils/confirm-irreversible.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const props = defineProps({
  // "snippets" | "history"
  mode: { type: String, default: "snippets" },
});
const emitToParent = defineEmits(["chip:tap"]);
const { snippets, history, truncateQuickText } = useQuickInputData();
const inputStore = useInputStore();
const { confirm } = useConfirm();

const isHistory = computed(() => props.mode === "history");
const items = computed(() =>
  isHistory.value ? history.value.map((text) => ({ command: text })) : snippets.value,
);
const emptyLabel = computed(() => (isHistory.value ? "No history" : "No snippets"));

const longPress = useLongPress(600);
let scrolled = false;
let startY = 0;

function onItemTouchStart(e, item, idx) {
  scrolled = false;
  startY = e.touches[0].clientY;
  longPress.reset();
  longPress.start(async () => {
    const label = isHistory.value ? "history entry" : "snippet";
    if (!(await confirmIrreversible(confirm, `Delete ${label} "${item.command}"?`))) return;
    if (isHistory.value) {
      inputStore.removeInputHistory(item.command);
    } else {
      bridgeEmit("snippet:delete", { index: snippets.value.length - 1 - idx });
    }
  });
}

function onChipTouchEnd(e, command) {
  if (scrolled) return;
  longPress.cancel();
  if (longPress.consumeFired()) return;
  if (e.cancelable) e.preventDefault();
  emitToParent("chip:tap", { command });
}

function onTouchMove(e) {
  if (!scrolled && Math.abs(e.touches[0].clientY - startY) > 10) {
    scrolled = true;
    longPress.cancel();
  }
}

function onTouchCancel() {
  longPress.cancel();
}
</script>
