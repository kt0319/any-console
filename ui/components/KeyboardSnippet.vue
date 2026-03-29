<template>
  <div class="quick-minimal-snippet-wrap" v-show="visible">
    <div class="quick-snippet-row">
      <div class="quick-snippet-scroll-row">
        <div
          v-for="(snippet, idx) in snippets"
          :key="'s-' + idx"
          class="quick-snippet-item"
          @touchstart="onSnippetTouchStart($event, snippet, idx)"
          @touchmove="onSnippetTouchMove($event)"
          @touchend="onSnippetTouchEnd($event, snippet, idx)"
          @touchcancel="onSnippetTouchCancel"
          @mousedown="onSnippetMouseDown($event, idx)"
          @mouseup="onSnippetMouseUp($event, snippet, idx)"
          @mouseleave="onSnippetMouseLeave"
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
          @touchend="onHistoryTouchEnd($event, text)"
          @touchcancel="onSnippetTouchCancel"
          @mouseup="onHistoryClick(text)"
        >
          <span class="mdi mdi-history snippet-chip-icon"></span>
          {{ truncateQuickText(text) }}
        </div>
        <div v-if="history.length === 0" class="quick-snippet-item quick-snippet-item-empty">No history</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useQuickInputData } from "../composables/useQuickInputData.js";
import { useLongPress } from "../composables/useLongPress.js";
import { emit } from "../app-bridge.js";

const visible = ref(false);
const snippetLongPress = useLongPress(600);
let scrolled = false;
let startX = 0;

const { snippets, history, truncateQuickText } = useQuickInputData();

function onSnippetTouchStart(e, snippet, idx) {
  scrolled = false;
  snippetLongPress.reset();
  startX = e.touches[0].clientX;
  snippetLongPress.start(() => {
    emit("snippet:delete", { index: snippets.value.length - 1 - idx });
  });
}

function onSnippetTouchMove(e) {
  if (!scrolled && Math.abs(e.touches[0].clientX - startX) > 10) {
    scrolled = true;
    snippetLongPress.cancel();
  }
}

function onSnippetTouchEnd(e, snippet, idx) {
  if (scrolled) return;
  snippetLongPress.cancel();
  if (snippetLongPress.consumeFired()) return;
  if (e.cancelable) e.preventDefault();
  emit("snippet:tap", { command: snippet.command });
}

function onSnippetTouchCancel() {
  snippetLongPress.cancel();
}

function onSnippetMouseDown(e, idx) {
  if (e.button !== 0) return;
  snippetLongPress.reset();
  snippetLongPress.start(() => {
    emit("snippet:delete", { index: snippets.value.length - 1 - idx });
  });
}

function onSnippetMouseUp(e, snippet, idx) {
  if (e.button !== 0) return;
  snippetLongPress.cancel();
  if (snippetLongPress.consumeFired()) return;
  emit("snippet:tap", { command: snippet.command });
}

function onSnippetMouseLeave() {
  snippetLongPress.cancel();
}

function onHistoryTouchStart(e, text) {
  scrolled = false;
  startX = e.touches[0].clientX;
}

function onHistoryTouchEnd(e, text) {
  if (scrolled) return;
  if (e.cancelable) e.preventDefault();
  emit("snippet:tap", { command: text });
}

function onHistoryClick(text) {
  emit("snippet:tap", { command: text });
}

function show() { visible.value = true; }
function hide() { visible.value = false; }
function toggle() { visible.value = !visible.value; }

defineExpose({ show, hide, toggle, visible });
</script>
