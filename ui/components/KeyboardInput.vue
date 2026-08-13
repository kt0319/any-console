<template>
  <div class="keyboard-input-wrapper" @pointerdown="markInternalInteraction">
    <form class="keyboard-input-row" autocomplete="off" role="presentation" @submit.prevent="submit">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="keyboard-input"
        rows="1"
        name="off"
        inputmode="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="send"
        :placeholder="placeholder"
        @keydown.escape="onEscape"
        @keydown.enter="onEnterKey"
        @keydown.up="(e) => onArrowKey(e, props.historyPrev, isFirstLine)"
        @keydown.down="(e) => onArrowKey(e, props.historyNext, isLastLine)"
        @compositionstart="composing = true"
        @compositionupdate="onInput"
        @compositionend="composing = false"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
      ></textarea>
    </form>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useInputStore } from "../stores/input.ts";
import { useKeyboard } from "../composables/useKeyboard.ts";
import { useHardwareKeyboard } from "../composables/useHardwareKeyboard.ts";
import { useSuppressedBlur } from "../composables/useSuppressedBlur.ts";
import { isComposingEvent } from "../utils/keyboard-event.ts";
import { isCaretOnFirstLine, isCaretOnLastLine } from "../utils/keyboard.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { KEYBOARD_INPUT_MIN_HEIGHT_PX, KEYBOARD_INPUT_MAX_HEIGHT_PX } from "../utils/constants.ts";

const emit = defineEmits(["focused", "submitted"]);
// フリックバーの矢印キーと同じ履歴↑↓状態を物理キーボードの矢印キーでも
// 使うため、useInputDraftHistoryは呼び直さず親（KeyboardBar.vue）が単一
// 生成したhistoryPrev/historyNextを受け取る（ここで別インスタンスを作ると
// historyIndexが別々になり、フリックと物理キーを混ぜて使った時に履歴が
// 正しく辿れなくなる）。
const props = defineProps({
  historyPrev: { type: Function, required: true },
  historyNext: { type: Function, required: true },
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
  if (focused.value) return "↑↓ history";
  return hasHardwareKeyboard.value ? "Tap (or Shift+Space) to input" : "Tap to input";
});

// 境界判定本体は純粋関数としてkeyboard.jsに置く（テスト対象）。
function isFirstLine(el) {
  return isCaretOnFirstLine(el.value, el.selectionStart);
}

function isLastLine(el) {
  return isCaretOnLastLine(el.value, el.selectionEnd);
}

// 複数行入力中はまずカーソル移動をブラウザ標準に任せ、最初/最後の行にいる
// ときだけ履歴↑↓として扱う（そうしないと行移動が一切できなくなる）。
function onArrowKey(e, action, atBoundary) {
  if (isComposingEvent(e, composing.value)) return;
  const el = inputEl.value;
  if (el && !atBoundary(el)) return;
  e.preventDefault();
  action();
}

// Enterで送信、Shift+Enterで改行。IME変換確定のEnterは素通しする。
function onEnterKey(e) {
  if (isComposingEvent(e, composing.value)) return;
  if (e.shiftKey) return;
  e.preventDefault();
  submit();
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
function onInput(e) {
  const value = e.target.value;
  if (draft.value !== value) draft.value = value;
}

function resizeTextarea() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, KEYBOARD_INPUT_MAX_HEIGHT_PX);
  el.style.height = `${Math.max(next, KEYBOARD_INPUT_MIN_HEIGHT_PX)}px`;
}

watch(draft, () => nextTick(resizeTextarea));
onMounted(resizeTextarea);

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
