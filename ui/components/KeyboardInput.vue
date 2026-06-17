<template>
  <div class="keyboard-input-wrapper" @pointerdown="markInternalInteraction">
    <form class="keyboard-input-row" autocomplete="off" role="presentation" @submit.prevent="submit">
      <input
        ref="inputEl"
        v-model="draft"
        class="keyboard-input"
        type="text"
        name="off"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="send"
        :placeholder="placeholder"
        @keydown.enter="onEnterKey"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @focus="onFocus"
        @blur="onBlur"
      />
    </form>
  </div>
</template>

<script setup>
import { ref, nextTick, computed } from "vue";
import { useInputStore } from "../stores/input.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const emit = defineEmits(["focused", "submitted"]);

const inputStore = useInputStore();
const { sendTextToTerminal, sendKeyToTerminal } = useKeyboard();

const draft = defineModel("draft", { default: "" });
const inputEl = ref(null);
const focused = ref(false);
const placeholder = computed(() => focused.value ? "↑↓ history · ←→ snippet" : "Tap to input");
let suppressBlurRefocus = false;
let refocusToken = 0;
const composing = ref(false);

function onEnterKey(e) {
  const isComposing = composing.value || e.isComposing || e.keyCode === 229;
  if (isComposing && draft.value.trim()) return;
  e.preventDefault();
  // ハードウェア Enter は text + Enter を atomic に送る。
  // iPhone Mirroring 等 keyup が抜ける環境でも Enter が確実に届く。
  submit({ sendEnter: true });
}

function onFocus() {
  focused.value = true;
  emit("focused", true);
  bridgeEmit("oskeyboard:show");
}

function blur() {
  suppressBlurRefocus = false;
  refocusToken += 1;
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
    const token = ++refocusToken;
    nextTick(() => { if (token === refocusToken) inputEl.value?.focus(); });
    return;
  }
  focused.value = false;
  emit("focused", false);
  bridgeEmit("oskeyboard:hide");
}

function markInternalInteraction() {
  suppressBlurRefocus = true;
}

function focus() {
  inputEl.value?.focus();
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

function submit({ sendEnter = false } = {}) {
  if (composing.value && draft.value.trim()) return;
  suppressBlurRefocus = false;
  refocusToken += 1;
  const text = draft.value.trim();
  if (!text) { sendKeyToTerminal({ key: "Enter" }); return; }
  sendTextToTerminal(text);
  // 物理キーボード Enter からの送信は Enter も付与する。
  // タッチ UI の送信ボタン経由（form @submit）は text のみで終了。
  if (sendEnter) sendKeyToTerminal({ key: "Enter" });
  inputStore.addInputHistory(text);
  draft.value = "";
  inputEl.value?.blur();
  emit("submitted");
}

defineExpose({ focus, blur, isFocused, appendChar, backspace, submit, moveCursor });
</script>
