<template>
  <div class="keyboard-input-wrapper" @pointerdown="markInternalInteraction">
    <div class="keyboard-input-row">
      <input
        ref="inputEl"
        v-model="draft"
        class="keyboard-input"
        type="search"
        name="off"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        :placeholder="placeholder"
        @keydown.enter.prevent="submit"
        @focus="onFocus"
        @blur="onBlur"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, computed } from "vue";
import { useInputStore } from "../stores/input.js";
import { useKeyboard } from "../composables/useKeyboard.js";

const emit = defineEmits(["focused", "submitted"]);

const inputStore = useInputStore();
const { sendTextToTerminal } = useKeyboard();

const draft = defineModel("draft", { default: "" });
const inputEl = ref(null);
const focused = ref(false);
const placeholder = computed(() => focused.value ? "Flick × ↑↓ history / ←→ cursor" : "Tap to text input");
let suppressBlurRefocus = false;

function onFocus() {
  focused.value = true;
  emit("focused", true);
}

function blur() {
  suppressBlurRefocus = false;
  inputEl.value?.blur();
}

function moveCursor(delta) {
  const el = inputEl.value;
  if (!el) return;
  const pos = Math.max(0, Math.min(el.value.length, (el.selectionStart || 0) + delta));
  el.setSelectionRange?.(pos, pos);
}

function onBlur() {
  if (suppressBlurRefocus) {
    suppressBlurRefocus = false;
    nextTick(() => inputEl.value?.focus());
    return;
  }
  focused.value = false;
  emit("focused", false);
}

function markInternalInteraction() {
  suppressBlurRefocus = true;
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

defineExpose({ focus, blur, isFocused, appendChar, backspace, submit, moveCursor });
</script>
