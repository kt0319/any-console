<template>
  <div class="keyboard-input-wrapper" @pointerdown="markInternalInteraction">
    <div class="keyboard-input-snippets">
      <KeyboardChips ref="chipsEl" :insert-mode="true" @chip:tap="onChipTap" />
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
        @focus="$emit('focused', true)"
        @blur="onBlur"
      />
      <button type="button" class="keyboard-input-send" @click="onSendClick">
        <span class="mdi" :class="draft.trim() ? 'mdi-send' : 'mdi-close'"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { useInputStore } from "../stores/input.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import KeyboardChips from "./KeyboardChips.vue";

const emit = defineEmits(["focused", "submitted", "closeRequested"]);

const inputStore = useInputStore();
const { sendTextToTerminal } = useKeyboard();

const draft = ref("");
const inputEl = ref(null);
const chipsEl = ref(null);
let suppressBlurRefocus = false;

function onBlur() {
  if (suppressBlurRefocus) {
    suppressBlurRefocus = false;
    nextTick(() => inputEl.value?.focus());
    return;
  }
  emit("focused", false);
}

function markInternalInteraction() {
  suppressBlurRefocus = true;
}

function onChipTap({ command }) {
  draft.value = command;
  nextTick(() => inputEl.value?.focus());
}

function focus() {
  nextTick(() => inputEl.value?.focus());
}

function isFocused() {
  return document.activeElement === inputEl.value;
}

function appendChar(text) {
  draft.value += text;
}

function backspace() {
  draft.value = draft.value.slice(0, -1);
}

function submit() {
  suppressBlurRefocus = false;
  const text = draft.value.trim();
  if (!text) return;
  sendTextToTerminal(text);
  inputStore.addInputHistory(text);
  draft.value = "";
  inputEl.value?.blur();
  emit("submitted");
}

function onSendClick() {
  if (draft.value.trim()) {
    submit();
  } else {
    suppressBlurRefocus = false;
    inputEl.value?.blur();
    emit("closeRequested");
  }
}

defineExpose({ focus, isFocused, appendChar, backspace, submit });
</script>
