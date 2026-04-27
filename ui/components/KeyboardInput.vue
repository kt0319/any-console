<template>
  <div v-if="visible">
    <div class="keyboard-input-overlay" @click="hide"></div>
    <div class="keyboard-input-wrapper quick-input" @pointerdown="markInternalInteraction">
      <div class="keyboard-input-snippets">
        <div class="quick-snippet-scroll-row">
          <button type="button" class="quick-snippet-item quick-snippet-add-btn" @click="addSnippetFromDraft">
            <span class="mdi mdi-plus"></span>
          </button>
          <button
            v-for="(snippet, idx) in snippets"
            :key="'s-' + idx"
            type="button"
            class="quick-snippet-item"
            @click="onSnippetClick(snippet)"
          >
            <span class="mdi mdi-pin snippet-chip-icon"></span>
            {{ truncateQuickText(snippet.label) }}
          </button>
          <div v-if="snippets.length === 0" class="quick-snippet-item quick-snippet-item-empty">No snippets</div>
        </div>
        <div class="quick-snippet-scroll-row">
          <button
            v-for="(text, idx) in history"
            :key="'h-' + idx"
            type="button"
            class="quick-snippet-item"
            @touchstart="onHistoryTouchStart($event, text)"
            @touchmove="onHistoryTouchMove($event)"
            @touchend="onHistoryTouchEnd($event, text)"
            @touchcancel="historyLongPress.cancel()"
            @mousedown="onHistoryMouseDown($event, text)"
            @mouseup="onHistoryMouseUp($event, text)"
            @mouseleave="historyLongPress.cancel()"
          >
            <span class="mdi mdi-history snippet-chip-icon"></span>
            {{ truncateQuickText(text) }}
          </button>
          <div v-if="history.length === 0" class="quick-snippet-item quick-snippet-item-empty">No history</div>
        </div>
      </div>
      <div class="keyboard-input-row">
        <input
          ref="inputEl"
          v-model="draft"
          class="keyboard-input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="Text input..."
          @keydown.enter.prevent="submit"
          @blur="onInputBlur"
        />
        <button type="button" class="keyboard-input-send" :disabled="!draft.trim()" @click="submit">
          <span class="mdi mdi-send"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { useInputStore } from "../stores/input.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useQuickInputData } from "../composables/useQuickInputData.js";
import { useLongPress } from "../composables/useLongPress.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const emitLocal = defineEmits(["visibility"]);

const inputStore = useInputStore();
const { sendTextToTerminal } = useKeyboard();

const visible = ref(false);
const draft = ref("");
const inputEl = ref(null);
let suppressBlurHide = false;

const { snippets, history, truncateQuickText } = useQuickInputData();

const historyLongPress = useLongPress(600);
let historyScrolled = false;
let historyStartX = 0;

function preventScroll(e) {
  if (e.target.closest(".quick-snippet-scroll-row")) return;
  e.preventDefault();
}

function show() {
  visible.value = true;
  emitLocal("visibility", true);
  document.addEventListener("touchmove", preventScroll, { passive: false });
  nextTick(() => inputEl.value?.focus());
}

function hide() {
  visible.value = false;
  emitLocal("visibility", false);
  document.removeEventListener("touchmove", preventScroll);
}

function onInputBlur() {
  if (suppressBlurHide) {
    suppressBlurHide = false;
    nextTick(() => inputEl.value?.focus());
    return;
  }
  if (visible.value) hide();
}

function markInternalInteraction() {
  suppressBlurHide = true;
}

function onSnippetClick(snippet) {
  bridgeEmit("snippet:reorder", { command: snippet.command });
  insertText(snippet.command);
}

function insertText(text) {
  if (!text) return;
  draft.value = draft.value ? `${draft.value} ${text}` : text;
  nextTick(() => inputEl.value?.focus());
}

function submit() {
  suppressBlurHide = false;
  const text = draft.value.trim();
  if (!text) return;
  sendTextToTerminal(text);
  inputStore.addInputHistory(text);
  bridgeEmit("layout:fitAll");
  draft.value = "";
  hide();
}

function addSnippetByPrompt(initialCommand) {
  markInternalInteraction();
  const command = prompt("Command to save as snippet:", initialCommand);
  if (!command) {
    nextTick(() => inputEl.value?.focus());
    return;
  }
  bridgeEmit("snippet:add", { command });
  nextTick(() => inputEl.value?.focus());
}

function addSnippetFromDraft() {
  addSnippetByPrompt(draft.value.trim());
}

function onHistoryTouchStart(e, text) {
  historyScrolled = false;
  historyStartX = e.touches[0].clientX;
  historyLongPress.reset();
  historyLongPress.start(() => {
    addSnippetByPrompt(text);
  });
}

function onHistoryTouchMove(e) {
  if (!historyScrolled && Math.abs(e.touches[0].clientX - historyStartX) > 10) {
    historyScrolled = true;
    historyLongPress.cancel();
  }
}

function onHistoryTouchEnd(e, text) {
  if (historyScrolled) return;
  historyLongPress.cancel();
  if (historyLongPress.consumeFired()) return;
  if (e.cancelable) e.preventDefault();
  insertText(text);
}

function onHistoryMouseDown(e, text) {
  if (e.button !== 0) return;
  historyLongPress.reset();
  historyLongPress.start(() => {
    addSnippetByPrompt(text);
  });
}

function onHistoryMouseUp(e, text) {
  if (e.button !== 0) return;
  historyLongPress.cancel();
  if (historyLongPress.consumeFired()) return;
  insertText(text);
}

defineExpose({ show, hide, visible, draft });
</script>
