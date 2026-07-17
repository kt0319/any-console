<template>
  <div class="quick-snippet-row">
    <div class="quick-snippet-scroll-row">
      <div
        v-for="(snippet, idx) in snippets"
        :key="'s-' + idx"
        class="quick-chip-item"
        @touchstart="onSnippetTouchStart($event, snippet, idx)"
        @touchmove="onTouchMove($event)"
        @touchend="onChipTouchEnd($event, snippet.command)"
        @touchcancel="onTouchCancel"
      >
        {{ truncateQuickText(snippet.command) }}
      </div>
      <div v-if="snippets.length === 0" class="quick-chip-item quick-chip-item-empty">No snippets</div>
    </div>
  </div>
</template>

<script setup>
import { useQuickInputData } from "../composables/useQuickInputData.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmIrreversible } from "../utils/confirm-irreversible.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const props = defineProps({ insertMode: { type: Boolean, default: false } });
const emitToParent = defineEmits(["chip:tap"]);
const { snippets, truncateQuickText } = useQuickInputData();
const { confirm } = useConfirm();

const longPress = useLongPress(600);
let scrolled = false;
let startY = 0;

function onSnippetTouchStart(e, snippet, idx) {
  scrolled = false;
  startY = e.touches[0].clientY;
  longPress.reset();
  longPress.start(async () => {
    if (await confirmIrreversible(confirm, `Delete snippet "${snippet.command}"?`)) {
      bridgeEmit("snippet:delete", { index: snippets.value.length - 1 - idx });
    }
  });
}

function onChipTouchEnd(e, command) {
  if (scrolled) return;
  longPress.cancel();
  if (longPress.consumeFired()) return;
  if (e.cancelable) e.preventDefault();
  if (!props.insertMode) bridgeEmit("snippet:tap", { command });
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
