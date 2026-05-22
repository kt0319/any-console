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
        {{ truncateQuickText(snippet.label) }}
      </div>
      <div v-if="snippets.length === 0" class="quick-chip-item quick-chip-item-empty">No snippets</div>
    </div>
  </div>
</template>

<script setup>
import { useQuickInputData } from "../composables/useQuickInputData.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useConfirm } from "../composables/useConfirm.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const props = defineProps({ insertMode: { type: Boolean, default: false } });
const emit = defineEmits(["chip:tap"]);
const { snippets, truncateQuickText } = useQuickInputData();
const { confirm } = useConfirm();

const longPress = useLongPress(600);
let scrolled = false;
let startX = 0;

function onSnippetTouchStart(e, snippet, idx) {
  scrolled = false;
  startX = e.touches[0].clientX;
  longPress.reset();
  longPress.start(async () => {
    const label = snippet.label || snippet.command;
    if (await confirm(`Delete snippet "${label}"? This cannot be undone.`)) {
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
  emit("chip:tap", { command });
}

function onTouchMove(e) {
  if (!scrolled && Math.abs(e.touches[0].clientX - startX) > 10) {
    scrolled = true;
    longPress.cancel();
  }
}

function onTouchCancel() {
  longPress.cancel();
}
</script>
