<template>
  <div class="keyboard-input-wrapper" @pointerdown="markInternalInteraction">
    <form class="keyboard-input-row" autocomplete="off" role="presentation" @submit.prevent="submit">
      <textarea
        :key="inputKey"
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

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type PropType, type Ref } from "vue";
import { useInputStore } from "../stores/input.ts";
import { useKeyboard } from "../composables/useKeyboard.ts";
import { useHardwareKeyboard } from "../composables/useHardwareKeyboard.ts";
import { useSuppressedBlur } from "../composables/useSuppressedBlur.ts";
import { isComposingEvent } from "../utils/keyboard-event.ts";
import { isCaretOnFirstLine, isCaretOnLastLine } from "../utils/keyboard.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { debugLog } from "../composables/useClientLogs.ts";

const emit = defineEmits(["focused", "submitted"]);
// 履歴↑↓状態をフリックバーと共有するため、親（KeyboardBar.vue）が単一生成したものを受け取る。
const props = defineProps({
  historyPrev: { type: Function as PropType<() => void>, required: true },
  historyNext: { type: Function as PropType<() => void>, required: true },
});

const inputStore = useInputStore();
const layoutStore = useLayoutStore();
const { sendTextToTerminal, sendKeyToTerminal } = useKeyboard();

const draft = defineModel<string>("draft", { default: "" });
const inputEl = ref<HTMLTextAreaElement | null>(null);
const focused = ref(false);
const composing = ref(false);
// iOS 27: 送信直後に value を書き換えて blur した textarea では変換候補が出なくなるため、送信ごとに作り直す。
const inputKey = ref(0);

// 実際に使うのは focus/blur/selection 系のみで textarea でも動く。
const { hasHardwareKeyboard } = useHardwareKeyboard({ inputEl: inputEl as unknown as Ref<HTMLInputElement | null>, composing });
const {
  markInternal: markInternalInteraction,
  blur,
  handleBlur,
  resetSuppression,
} = useSuppressedBlur(inputEl as Ref<HTMLElement | null>);

const placeholder = computed(() => {
  if (focused.value) return "↑↓ history";
  return hasHardwareKeyboard.value ? "Tap (or Shift+Space) to input" : "Tap to input";
});

function isFirstLine(el: HTMLTextAreaElement) {
  return isCaretOnFirstLine(el.value, el.selectionStart);
}

function isLastLine(el: HTMLTextAreaElement) {
  return isCaretOnLastLine(el.value, el.selectionEnd);
}

// 複数行入力中は最初/最後の行にいる時だけ履歴↑↓として扱う（行移動を潰さないため）。
function onArrowKey(e: KeyboardEvent, action: () => void, atBoundary: (el: HTMLTextAreaElement) => boolean) {
  if (isComposingEvent(e, composing.value)) return;
  const el = inputEl.value;
  if (el && !atBoundary(el)) return;
  e.preventDefault();
  action();
}

// Shift+Enter は改行。IME 変換確定の Enter は素通し。
function onEnterKey(e: KeyboardEvent) {
  if (isComposingEvent(e, composing.value)) return;
  if (e.shiftKey) return;
  e.preventDefault();
  submit();
}

// IME 変換中の Esc は変換キャンセル用なので素通し。
function onEscape(e: KeyboardEvent) {
  if (isComposingEvent(e, composing.value)) return;
  e.preventDefault();
  blur();
}

function onFocus() {
  focused.value = true;
  emit("focused", true);
  layoutStore.isOsKeyboardOpen = true;
}

// vModelText は IME 変換中 draft.value を更新しないため、input/compositionupdate を直接見て追従させる。
function onInput(e: Event) {
  // 作り直し前の要素から遅れて届くイベント（blur 時の変換確定など）で draft を書き戻さない
  if (e.target !== inputEl.value) return;
  const value = (e.target as HTMLTextAreaElement).value;
  if (draft.value !== value) draft.value = value;
}

function moveCursor(delta: number) {
  const el = inputEl.value;
  if (!el) return;
  const pos = Math.max(0, Math.min(el.value.length, (el.selectionStart || 0) + delta));
  el.setSelectionRange?.(pos, pos);
}

// iOS PWA では変換途中で compositionend が届かないことがあり、フラグが残ると入力が無視され v-model も止まる（開き直すまで直らない）。
function resetCompositionState(reason: string) {
  const el = inputEl.value as (HTMLTextAreaElement & { composing?: boolean }) | null;
  if (composing.value || el?.composing) {
    debugLog("[IME]", "reset stale composition state", reason);
  }
  composing.value = false;
  if (el) el.composing = false;
}

// 復帰時に入力セッションがずれ変換候補が出なくなることがある（推測）。非フォーカスなら送信時と同じく要素を作り直す。
function recoverInputOnResume(reason: string) {
  resetCompositionState(reason);
  if (isFocused()) return;
  inputKey.value += 1;
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") recoverInputOnResume("visible");
}

function onPageShow() {
  recoverInputOnResume("pageshow");
}

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", onPageShow);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pageshow", onPageShow);
});

function onBlur() {
  resetCompositionState("blur");
  if (!handleBlur()) return;
  focused.value = false;
  emit("focused", false);
  layoutStore.isOsKeyboardOpen = false;
}

function focus() {
  inputEl.value?.focus();
}

function isFocused() {
  return document.activeElement === inputEl.value;
}

function appendChar(text: string) {
  draft.value += text;
}

function backspace() {
  draft.value = draft.value.slice(0, -1);
}

function submit() {
  resetSuppression();
  const el = inputEl.value;
  // IME 変換中は draft.value が追従しないことがあるため el.value を直接読む。
  const raw = el ? el.value : draft.value;
  // 空白のみなら Enter 単体送信。それ以外は先頭空白も含め raw 送信（HISTCONTROL=ignorespace 用）。
  if (!raw.trim()) {
    draft.value = "";
    if (el?.value) el.value = "";
    sendKeyToTerminal({ key: "Enter" });
    return;
  }
  sendTextToTerminal(raw);
  inputStore.addInputHistory(raw);
  // 先に blur して変換を確定させてから draft を空にする。変換中の要素へは value を書かず、作り直しで空にする。
  el?.blur();
  composing.value = false;
  draft.value = "";
  inputKey.value += 1;
  emit("submitted");
}

defineExpose({ focus, blur, isFocused, appendChar, backspace, submit, moveCursor });
</script>
