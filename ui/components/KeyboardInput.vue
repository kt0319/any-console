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
        @keydown.escape="onEscape"
        @keydown.up="(e) => onArrowKey(e, historyPrev)"
        @keydown.down="(e) => onArrowKey(e, historyNext)"
        @compositionstart="composing = true"
        @compositionupdate="syncDraftFromDom"
        @compositionend="composing = false"
        @input="syncDraftFromDom"
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
import { useInputDraftHistory } from "../composables/useInputDraftHistory.js";
import { useHardwareKeyboard } from "../composables/useHardwareKeyboard.js";
import { useSuppressedBlur } from "../composables/useSuppressedBlur.js";
import { isComposingEvent } from "../utils/keyboard-event.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const emit = defineEmits(["focused", "submitted"]);

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
  if (focused.value) return "↑↓ history";
  return hasHardwareKeyboard.value ? "Tap (or Shift+Space) to input" : "Tap to input";
});

// フリックバーの矢印キーと同じ挙動（履歴↑↓）を
// 物理キーボードの矢印キーでも再現するため、同じ composable を再利用する。
const { historyPrev, historyNext } = useInputDraftHistory(draft);

function onArrowKey(e, action) {
  if (isComposingEvent(e, composing.value)) return;
  e.preventDefault();
  action();
}

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

// v-model（vModelText）はIME変換中（compositionstart〜compositionend）は
// draft.value への反映を止める仕様のため、hasDraft（親のsend/enterアイコン
// 切替）が変換中の未確定文字列を拾えない。DOMのinput/compositionupdateを
// 直接見て draft.value を追従させ、変換中でも送信ボタンをsend表示にする。
function syncDraftFromDom(e) {
  const value = e.target.value;
  if (draft.value !== value) draft.value = value;
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
  resetSuppression();
  const el = inputEl.value;
  // IME変換中はVueのv-model（compositionstart〜endの間はDOMへの反映を
  // 自前で止める仕様）が追従しないため draft.value が変換中の文字列を
  // 反映していないことがある。実際に画面に出ている el.value を直接読む。
  const text = (el ? el.value : draft.value).trim();
  // テキストが空なら Enter 単体送信、あれば text のみ送信（Enter は付けない）。
  if (!text) {
    draft.value = "";
    if (el) el.value = "";
    sendKeyToTerminal({ key: "Enter" });
    return;
  }
  sendTextToTerminal(text);
  inputStore.addInputHistory(text);
  draft.value = "";
  // draft.value を空にしても IME 変換中（el.composing）はVue側がDOM更新を
  // スキップするため、el.value も直接空にしてIME入力中の未確定文字列を消す。
  if (el) el.value = "";
  el?.blur();
  emit("submitted");
}

defineExpose({ focus, blur, isFocused, appendChar, backspace, submit, moveCursor });
</script>
