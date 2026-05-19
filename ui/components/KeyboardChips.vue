<template>
  <div class="quick-snippet-row">
    <div class="quick-snippet-scroll-row">
      <button type="button" class="quick-snippet-item quick-snippet-add-btn" @click="onAddClick">
        <span class="mdi mdi-plus"></span>
      </button>
      <div
        v-for="(snippet, idx) in snippets"
        :key="'s-' + idx"
        class="quick-snippet-item"
        @touchstart="onSnippetTouchStart($event, snippet, idx)"
        @touchmove="onTouchMove($event)"
        @touchend="onSnippetTouchEnd($event, snippet, idx)"
        @touchcancel="onTouchCancel"
      >
        <span class="mdi mdi-pin snippet-chip-icon"></span>
        {{ truncateQuickText(snippet.label) }}
      </div>
      <div v-if="snippets.length === 0" class="quick-snippet-item quick-snippet-item-empty">No snippets</div>
    </div>
    <div class="quick-snippet-scroll-row">
      <div
        v-for="(text, idx) in history"
        :key="'h-' + idx"
        class="quick-snippet-item"
        @touchstart="onHistoryTouchStart($event, text)"
        @touchmove="onTouchMove($event)"
        @touchend="onHistoryTouchEnd($event, text)"
        @touchcancel="onTouchCancel"
      >
        <span class="mdi mdi-history snippet-chip-icon"></span>
        {{ truncateQuickText(text) }}
      </div>
      <div v-if="history.length === 0" class="quick-snippet-item quick-snippet-item-empty">No history</div>
    </div>
  </div>
</template>

<script setup>
import { useQuickInputData } from "../composables/useQuickInputData.js";
import { useLongPress } from "../composables/useLongPress.js";
import { usePrompt } from "../composables/usePrompt.js";
import { useConfirm } from "../composables/useConfirm.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const emit = defineEmits(["chip:tap"]);
const { snippets, history, truncateQuickText } = useQuickInputData();
const { prompt } = usePrompt();
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

function onSnippetTouchEnd(e, snippet) {
  if (scrolled) return;
  longPress.cancel();
  if (longPress.consumeFired()) return;
  if (e.cancelable) e.preventDefault();
  bridgeEmit("snippet:tap", { command: snippet.command });
  emit("chip:tap");
}

function onHistoryTouchStart(e, text) {
  scrolled = false;
  startX = e.touches[0].clientX;
  longPress.reset();
  longPress.start(() => {
    askAddSnippet(text);
  });
}

function onHistoryTouchEnd(e, text) {
  if (scrolled) return;
  longPress.cancel();
  if (longPress.consumeFired()) return;
  if (e.cancelable) e.preventDefault();
  bridgeEmit("snippet:tap", { command: text });
  emit("chip:tap");
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

async function askAddSnippet(initial = "") {
  const command = await prompt({
    title: "Save Snippet",
    message: "Enter command to save as snippet.",
    initialValue: initial,
    placeholder: "echo hello",
  });
  if (!command) return;
  bridgeEmit("snippet:add", { command });
}

function onAddClick() {
  askAddSnippet("");
}

defineExpose({ askAddSnippet });
</script>
