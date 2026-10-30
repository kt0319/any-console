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
// フリックバーと物理キーボードで履歴↑↓状態を共有するため、useInputDraftHistoryを
// ここで作り直さず親（KeyboardBar.vue）が単一生成したものを受け取る（別インスタンスに
// するとhistoryIndexが分かれ、混ぜて使った時に履歴を正しく辿れなくなる）。
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
// 送信のたびに textarea を作り直す。iOS 27 では、送信直後に value を書き換えて blur した
// textarea で次の入力を始めると、かな入力は入るが変換候補が出なくなる（アプリを開き直すまで直らない）。
// 新しい要素なら入力セッションが初期状態から始まる。
const inputKey = ref(0);

// useHardwareKeyboard / useSuppressedBlur は input 要素前提の型だが、
// 実際に使うのは両要素共通の focus/blur/selection 系のみ（textarea でも動く）。
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

// 境界判定本体は純粋関数としてkeyboard.tsに置く（テスト対象）。
function isFirstLine(el: HTMLTextAreaElement) {
  return isCaretOnFirstLine(el.value, el.selectionStart);
}

function isLastLine(el: HTMLTextAreaElement) {
  return isCaretOnLastLine(el.value, el.selectionEnd);
}

// 複数行入力中はまずカーソル移動をブラウザ標準に任せ、最初/最後の行にいる
// ときだけ履歴↑↓として扱う（そうしないと行移動が一切できなくなる）。
function onArrowKey(e: KeyboardEvent, action: () => void, atBoundary: (el: HTMLTextAreaElement) => boolean) {
  if (isComposingEvent(e, composing.value)) return;
  const el = inputEl.value;
  if (el && !atBoundary(el)) return;
  e.preventDefault();
  action();
}

// Enterで送信、Shift+Enterで改行。IME変換確定のEnterは素通しする。
function onEnterKey(e: KeyboardEvent) {
  if (isComposingEvent(e, composing.value)) return;
  if (e.shiftKey) return;
  e.preventDefault();
  submit();
}

// 入力モード中の Esc で入力モードを抜ける（フォーカスを外す）。
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

// v-model（vModelText）はIME変換中はdraft.valueへの反映を止める仕様のため、
// hasDraft（親のsend/enterアイコン切替）が未確定文字列を拾えない。DOMのinput/
// compositionupdateを直接見てdraft.valueを追従させる。
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

// iOS の PWA はバックグラウンド化・キーボード閉じ・blur のタイミングによっては変換の途中で
// compositionend が届かない。フラグが立ったままだと、Enter/Esc/矢印と物理キー入力が
// 以後ずっと「変換中」として無視され、Vue の v-model も el.composing が true の間は
// draft → DOM の反映を止めるため、フリックバー等からの入力が画面に出なくなる（開き直すまで直らない）。
function resetCompositionState(reason: string) {
  const el = inputEl.value as (HTMLTextAreaElement & { composing?: boolean }) | null;
  if (composing.value || el?.composing) {
    debugLog("[IME]", "reset stale composition state", reason);
  }
  composing.value = false;
  if (el) el.composing = false;
}

// 復帰時に OS 側の入力セッションがずれ、かな入力は入るのに変換候補が出なくなることがある（推測）。
// 送信時と同じく、フォーカスしていない（キーボードが閉じている）なら要素を作り直して初期状態に戻す。
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
  // IME変換中はVueのv-model（compositionstart〜endの間はDOMへの反映を
  // 自前で止める仕様）が追従しないため draft.value が変換中の文字列を
  // 反映していないことがある。実際に画面に出ている el.value を直接読む。
  const raw = el ? el.value : draft.value;
  // テキストが空（空白のみ含む）なら Enter 単体送信。ある場合は先頭・末尾の
  // 空白を落とさず raw のまま送信する（HISTCONTROL=ignorespace 等、先頭
  // スペース付きコマンドを打つユースケースがあるため）。
  if (!raw.trim()) {
    draft.value = "";
    if (el?.value) el.value = "";
    sendKeyToTerminal({ key: "Enter" });
    return;
  }
  sendTextToTerminal(raw);
  inputStore.addInputHistory(raw);
  // 先に blur して変換を確定させる（compositionend / input が同期で走り、v-model が確定文字列を
  // draft へ戻す）。draft を空にするのはその後。変換セッションが開いたままの要素へは
  // value を書き込まず、空の状態は要素の作り直しで得る。
  el?.blur();
  composing.value = false;
  draft.value = "";
  inputKey.value += 1;
  emit("submitted");
}

defineExpose({ focus, blur, isFocused, appendChar, backspace, submit, moveCursor });
</script>
