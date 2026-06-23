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
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @focus="onFocus"
        @blur="onBlur"
      />
    </form>
  </div>
</template>

<script setup>
import { ref, nextTick, computed, onMounted, onBeforeUnmount } from "vue";
import { useInputStore } from "../stores/input.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { keyDefToAnsi } from "../utils/key-ansi.js";
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

// 物理（外付け）キーボード判定: KeyboardEvent.code は物理キー由来のときだけ
// "KeyA"/"Enter"/"Backspace" 等の値を持つ。iOS のソフトキーボード由来は
// e.code が "" や "Unidentified" になる。
function isHardwareKeyboardEvent(e) {
  return !!e?.code && e.code !== "Unidentified";
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

function submit() {
  if (composing.value && draft.value.trim()) return;
  suppressBlurRefocus = false;
  refocusToken += 1;
  const text = draft.value.trim();
  // テキストが空なら Enter 単体送信、あれば text のみ送信（Enter は付けない）。
  if (!text) { sendKeyToTerminal({ key: "Enter" }); return; }
  sendTextToTerminal(text);
  inputStore.addInputHistory(text);
  draft.value = "";
  inputEl.value?.blur();
  emit("submitted");
}

// 物理キーボード時はフォーカス位置に関係なく特殊キーを拾うために window で listen。
// input に focus が無くてもターミナル枠が表に出ていれば BS/Tab/Esc/矢印 が直接届く。
// 入力モード（input フォーカス時）は draft 蓄積に専念し、Enter は form @submit
// で送信される。通常時（input にフォーカスなし）かつ物理キーボード由来の
// キーだけ、ターミナルへ直接送る。
function onGlobalKeydown(e) {
  // Shift+Space で input フォームへフォーカス（入力モード切替ショートカット）。
  if (e.code === "Space" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!isFocused()) {
      e.preventDefault();
      focus();
    }
    return;
  }
  if (isFocused()) return;
  const target = /** @type {HTMLElement | null} */ (e.target);
  if (target && target !== inputEl.value) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
  }
  if (!isHardwareKeyboardEvent(e)) return;
  if (composing.value || e.isComposing || e.keyCode === 229) return;
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
  const keyDef = { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey };
  const seq = keyDefToAnsi(keyDef);
  if (seq == null) return;
  e.preventDefault();
  sendKeyToTerminal(keyDef);
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown, true);
});

defineExpose({ focus, blur, isFocused, appendChar, backspace, submit, moveCursor });
</script>
