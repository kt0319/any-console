<template>
  <div class="keyboard-input-wrapper" @pointerdown="markInternalInteraction">
    <form class="keyboard-input-row" autocomplete="off" role="presentation" @submit.prevent="submit">
      <button
        type="button"
        class="keyboard-input-snippet-btn"
        :class="{ active: snippetView !== 'none' }"
        :aria-label="snippetButtonLabel"
        :data-tooltip="snippetButtonLabel"
        @pointerdown.prevent
        @click="emit('snippetToggle')"
      >
        <span class="mdi" :class="snippetButtonIcon"></span>
      </button>
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
        @keydown.escape="onEscape"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @focus="onFocus"
        @blur="onBlur"
      />
    </form>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useInputStore } from "../stores/input.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useHardwareKeyboard } from "../composables/useHardwareKeyboard.js";
import { useSuppressedBlur } from "../composables/useSuppressedBlur.js";
import { isComposingEvent } from "../utils/keyboard-event.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const props = defineProps({
  // "none" | "snippets" | "history"
  snippetView: { type: String, default: "none" },
});
const emit = defineEmits(["focused", "submitted", "snippetToggle"]);

// ボタンのアイコン/ラベルは次にタップしたら遷移する先を表す（予告型）。
// 巡回順: none(→Snippets) → snippets(→History) → history(→Close) → none…
const snippetButtonIcon = computed(() => {
  if (props.snippetView === "snippets") return "mdi-history";
  if (props.snippetView === "history") return "mdi-close";
  return "mdi-bookmark-multiple";
});
const snippetButtonLabel = computed(() => {
  if (props.snippetView === "snippets") return "History";
  if (props.snippetView === "history") return "Close";
  return "Snippets";
});

const inputStore = useInputStore();
const { sendTextToTerminal, sendKeyToTerminal } = useKeyboard();

const draft = defineModel("draft", { default: "" });
const inputEl = ref(null);
const focused = ref(false);
const composing = ref(false);

const { hasHardwareKeyboard } = useHardwareKeyboard({ inputEl, composing });
const {
  markInternal: markInternalInteraction,
  blur,
  handleBlur,
  resetSuppression,
} = useSuppressedBlur(inputEl);

const placeholder = computed(() => {
  if (focused.value) return "";
  return hasHardwareKeyboard.value ? "Tap (or Shift+Space) to input" : "Tap to input";
});

// 入力モード中の Esc で入力モードを抜ける（フォーカスを外す）。
// IME 変換中の Esc は変換キャンセル用なので素通し。
function onEscape(e) {
  if (isComposingEvent(e, composing.value)) return;
  e.preventDefault();
  blur();
}

function onFocus() {
  focused.value = true;
  emit("focused", true);
  bridgeEmit("oskeyboard:show");
}

function moveCursor(delta) {
  const el = inputEl.value;
  if (!el) return;
  const pos = Math.max(0, Math.min(el.value.length, (el.selectionStart || 0) + delta));
  el.setSelectionRange?.(pos, pos);
}

function onBlur() {
  if (!handleBlur()) return;
  focused.value = false;
  emit("focused", false);
  bridgeEmit("oskeyboard:hide");
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

function submit() {
  if (composing.value && draft.value.trim()) return;
  resetSuppression();
  const text = draft.value.trim();
  // テキストが空なら Enter 単体送信、あれば text のみ送信（Enter は付けない）。
  if (!text) { sendKeyToTerminal({ key: "Enter" }); return; }
  sendTextToTerminal(text);
  inputStore.addInputHistory(text);
  draft.value = "";
  inputEl.value?.blur();
  emit("submitted");
}

defineExpose({ focus, blur, isFocused, appendChar, backspace, submit, moveCursor });
</script>
