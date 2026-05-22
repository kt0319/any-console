<template>
  <div v-if="visible">
    <div class="keyboard-input-wrapper quick-input" @pointerdown="markInternalInteraction">
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
import KeyboardChips from "./KeyboardChips.vue";

const emit = defineEmits(["visibility"]);

const inputStore = useInputStore();
const { sendTextToTerminal } = useKeyboard();

const visible = ref(false);
const draft = ref("");
const inputEl = ref(null);
const chipsEl = ref(null);
let suppressBlurHide = false;

function preventScroll(e) {
  if (e.target.closest(".quick-snippet-scroll-row")) return;
  e.preventDefault();
}

function show() {
  visible.value = true;
  emit("visibility", true);
  document.addEventListener("touchmove", preventScroll, { passive: false });
  nextTick(() => inputEl.value?.focus());
}

function hide() {
  visible.value = false;
  emit("visibility", false);
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

function onChipTap({ command }) {
  draft.value = command;
  nextTick(() => inputEl.value?.focus());
}

function submit() {
  suppressBlurHide = false;
  const text = draft.value.trim();
  if (!text) return;
  sendTextToTerminal(text);
  inputStore.addInputHistory(text);
  draft.value = "";
  hide();
}

defineExpose({ show, hide, visible, draft });
</script>
