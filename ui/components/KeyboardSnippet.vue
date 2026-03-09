<template>
  <div class="quick-minimal-snippet-wrap" v-show="visible">
    <div class="quick-snippet-row" ref="snippetRowEl">
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
          {{ truncate(snippet.label) }}
        </div>
        <div v-if="snippets.length === 0" class="quick-snippet-item quick-snippet-item-empty">スニペットなし</div>
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
          {{ truncate(text) }}
        </div>
        <div v-if="history.length === 0" class="quick-snippet-item quick-snippet-item-empty">履歴なし</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useInputStore } from "../stores/input.js";
import { useAuthStore } from "../stores/auth.js";
import { emit } from "../app-bridge.js";

const inputStore = useInputStore();
const auth = useAuthStore();

const visible = ref(false);
const snippetRowEl = ref(null);
let longPressTimer = null;
let longPressFired = false;
let scrolled = false;
let startX = 0;

const snippets = computed(() => inputStore.snippetsCache ? [...inputStore.snippetsCache].reverse() : []);
const history = computed(() => inputStore.inputHistory ? [...inputStore.inputHistory] : []);

function truncate(text) {
  return text && text.length > 20 ? text.slice(0, 20) + "\u2026" : text || "";
}

function onSnippetTouchStart(e, snippet, idx) {
  scrolled = false;
  longPressFired = false;
  startX = e.touches[0].clientX;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    longPressFired = true;
    emit("snippet:delete", { index: snippets.value.length - 1 - idx });
  }, 600);
}

function onSnippetTouchMove(e) {
  if (!scrolled && Math.abs(e.touches[0].clientX - startX) > 10) {
    scrolled = true;
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  }
}

function onSnippetTouchEnd(e, snippet, idx) {
  if (scrolled || longPressFired) return;
  if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (e.cancelable) e.preventDefault();
  emit("snippet:tap", { command: snippet.command });
}

function onSnippetTouchCancel() {
  if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function onSnippetMouseDown(e, idx) {
  if (e.button !== 0) return;
  longPressFired = false;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    longPressFired = true;
    emit("snippet:delete", { index: snippets.value.length - 1 - idx });
  }, 600);
}

function onSnippetMouseUp(e, snippet, idx) {
  if (e.button !== 0) return;
  if (longPressFired) return;
  if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  emit("snippet:tap", { command: snippet.command });
}

function onSnippetMouseLeave() {
  if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
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
