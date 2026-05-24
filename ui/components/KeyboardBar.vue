<template>
  <div v-if="isVisible" class="keyboard-bar">
    <KeyboardQwertyKey
      ref="qwertyView"
      :active="isFullKeyboard"
      :hide-bottom-row="true"
      :external-input-focused="inputFocused"
      :external-snippet-view="showSnippetView"
      @cycleMode="toggleKeyboard"
      @submitted="onSubmitted"
    />
    <!-- ミニマムモード時のスニペット表示 -->
    <div v-if="showSnippetView" class="keyboard-bar-snippets">
      <KeyboardChips :insert-mode="true" @chip:tap="onChipTap" />
    </div>
    <!-- バー行 = フルキーボードの最下行と同構成 -->
    <div class="keyboard-bar-row">
      <KeyboardInput
        ref="keyboardInput"
        v-model:draft="draft"
        @focused="onInputFocused"
        @submitted="onSubmitted"
      />
      <div class="quick-key quick-flick-arrow quick-key-toggle" :class="{ active: isFullKeyboard || inputFocused }" ref="barArrowFlickEl">
        <span class="flick-hint-top">&uarr;</span>
        <span class="flick-hint-left">&larr;</span>
        <span class="flick-main"><span :class="['mdi', (isFullKeyboard || inputFocused) ? 'mdi-close' : 'mdi-keyboard']"></span></span>
        <span class="flick-hint-right">&rarr;</span>
        <span class="flick-hint-bottom">&darr;</span>
      </div>
      <div
        class="quick-key quick-flick-enter quick-flick-arrow quick-key-toggle"
        :class="{ 'enter-send-mode': inputFocused && hasDraft, 'enter-disabled': inputFocused && !hasDraft }"
        ref="barEnterFlickEl"
      >
        <template v-if="inputFocused">
          <span class="flick-main"><span class="mdi mdi-send"></span></span>
        </template>
        <template v-else>
          <span class="flick-hint-top">Tab</span>
          <span class="flick-hint-left">BS</span>
          <span class="flick-main">&crarr;</span>
          <span class="flick-hint-bottom">Space</span>
          <span class="flick-hint-right">Del</span>
        </template>
      </div>
      <div
        class="quick-key snippet-toggle-btn quick-modifier"
        :class="{ active: showSnippetView }"
        @touchstart.prevent="snippetFlick.onStart"
        @touchend.prevent="snippetFlick.onEnd"
        @touchcancel="onQuickKeyCancel"
        @click="toggleSnippetView"
      >
        <span class="flick-main"><span class="mdi mdi-bookmark-multiple"></span></span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useLayoutStore } from "../stores/layout.js";
import { useInputStore } from "../stores/input.js";
import { on } from "../app-bridge.js";
import { REPEAT_DELAY, REPEAT_INTERVAL, MIN_REPEAT_INTERVAL, REPEAT_ACCELERATION } from "../utils/constants.js";
import { arrowResolver, enterResolver } from "../utils/flick-resolvers.js";
import { createFlickHandlers } from "../utils/flick-handlers.js";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";
import KeyboardChips from "./KeyboardChips.vue";

const props = defineProps({
  isPanelBottom: { type: Boolean, default: false },
});

const layoutStore = useLayoutStore();
const inputStore = useInputStore();
const isVisible = computed(() => props.isPanelBottom || layoutStore.isSplitMode);

const { clearModifiers, sendKeyToTerminal, sendTextToTerminal, setupFlickRepeat } = useKeyboard();

const isFullKeyboard = ref(false);
const qwertyView = ref(null);
const keyboardInput = ref(null);
const barArrowFlickEl = ref(null);
const barEnterFlickEl = ref(null);

// ─── 入力 / スニペット状態 ─────────────────────────────────────
const draft = ref("");
const inputFocused = ref(false);
const showSnippetView = ref(false);
const hasDraft = computed(() => draft.value.trim().length > 0);

let historyIndex = -1;
let savedDraft = "";

watch(draft, (val) => { if (val === "") historyIndex = -1; });

function historyPrev() {
  const list = inputStore.inputHistory;
  if (!list.length) return;
  if (historyIndex === -1) savedDraft = draft.value;
  historyIndex = Math.min(historyIndex + 1, list.length - 1);
  draft.value = list[historyIndex];
}
function historyNext() {
  if (historyIndex === -1) return;
  historyIndex -= 1;
  if (historyIndex < 0) {
    historyIndex = -1;
    draft.value = savedDraft;
    return;
  }
  draft.value = inputStore.inputHistory[historyIndex];
}

function onInputFocused(focused) {
  inputFocused.value = !!focused;
}

function toggleSnippetView() {
  showSnippetView.value = !showSnippetView.value;
  if (showSnippetView.value) {
    isFullKeyboard.value = false;
    clearModifiers();
  }
}
const snippetFlick = createFlickHandlers({ tap: toggleSnippetView });

function onQuickKeyCancel(e) {
  e.currentTarget.classList.remove("pressed");
}

function onChipTap({ command }) {
  if (inputFocused.value) {
    draft.value = command;
    keyboardInput.value?.focus?.();
  } else {
    sendTextToTerminal(command);
    inputStore.addInputHistory(command);
  }
  showSnippetView.value = false;
}

// ─── キーボード開閉 ────────────────────────────────────────────
function showInput() {
  isFullKeyboard.value = true;
  showSnippetView.value = false;
  nextTick(() => keyboardInput.value?.focus?.());
}

function hideInput() {
  isFullKeyboard.value = false;
  clearModifiers();
}

function toggleKeyboard() {
  isFullKeyboard.value = false;
  clearModifiers();
}

function dismissKeyboard() {
  // 入力フォーカス中のみ（フルキーボードなし）は blur だけ。それ以外はトグル
  if (!isFullKeyboard.value && inputFocused.value) {
    keyboardInput.value?.blur?.();
    clearModifiers();
    return;
  }
  keyboardInput.value?.blur?.();
  isFullKeyboard.value = !isFullKeyboard.value;
  if (isFullKeyboard.value) showSnippetView.value = false;
  clearModifiers();
}

function onSubmitted() {
  hideInput();
}

// ─── バー行の arrow / enter flick セットアップ ────────────────
onMounted(() => {
  if (barArrowFlickEl.value) {
    let arrowFlickHandled = false;
    let cursorRepeatKey = null;
    let cursorRepeatTimer = null;
    const cursorStopRepeat = () => {
      if (cursorRepeatTimer !== null) { clearTimeout(cursorRepeatTimer); cursorRepeatTimer = null; }
      cursorRepeatKey = null;
    };
    const cursorScheduleRepeat = (delta, interval) => {
      cursorRepeatTimer = setTimeout(() => {
        if (cursorRepeatKey === null) return;
        keyboardInput.value?.moveCursor?.(delta);
        cursorScheduleRepeat(delta, Math.max(MIN_REPEAT_INTERVAL, interval - REPEAT_ACCELERATION));
      }, interval);
    };
    barArrowFlickEl.value.addEventListener("touchstart", () => {
      arrowFlickHandled = false;
      cursorStopRepeat();
    }, { passive: true });
    barArrowFlickEl.value.addEventListener("touchend", cursorStopRepeat);
    barArrowFlickEl.value.addEventListener("touchcancel", cursorStopRepeat);
    const onArrowFlick = (key) => {
      if (!inputFocused.value) return false;
      if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
        if (cursorRepeatKey === key.key) return true;
        cursorStopRepeat();
        cursorRepeatKey = key.key;
        const delta = key.key === "ArrowLeft" ? -1 : 1;
        keyboardInput.value?.moveCursor?.(delta);
        cursorRepeatTimer = setTimeout(() => cursorScheduleRepeat(delta, REPEAT_INTERVAL), REPEAT_DELAY);
        return true;
      }
      if (arrowFlickHandled) return true;
      arrowFlickHandled = true;
      if (key.key === "ArrowUp") historyPrev();
      else if (key.key === "ArrowDown") historyNext();
      return true;
    };
    setupFlickRepeat(barArrowFlickEl.value, arrowResolver, dismissKeyboard, {
      accelerateRepeat: true,
      onFlick: onArrowFlick,
    });
  }

  if (barEnterFlickEl.value) {
    const enterFlickResolver = (dx, dy, threshold) => {
      if (inputFocused.value) return null;
      return enterResolver(dx, dy, threshold);
    };
    setupFlickRepeat(barEnterFlickEl.value, enterFlickResolver, () => {
      if (inputFocused.value) {
        if (hasDraft.value) keyboardInput.value?.submit?.();
        return;
      }
      sendKeyToTerminal({ key: "Enter" });
    }, { accelerateRepeat: true });
  }
});

const cleanups = [
  on("keyboard:activate", showInput),
  on("keyboard:deactivate", hideInput),
];
onUnmounted(() => cleanups.forEach((fn) => fn()));
</script>

<style>
/* ─── KeyboardBar ──────────────────────────────────────────────────────────── */
.keyboard-bar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

/* フルキーボードはバー行の上にフロート */
.keyboard-bar {
  position: relative;
}

.keyboard-bar .quick-extra-panel {
  position: absolute !important;
  bottom: 100% !important;
  left: 0;
  right: 0;
  z-index: 30;
  background: transparent;
  border-top: none;
  border-bottom: none;
  padding: 4px;
}

.keyboard-bar-snippets {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  z-index: 30;
  padding: 4px;
  background: transparent;
}

.keyboard-bar-row {
  display: flex;
  flex-direction: row;
  gap: 4px;
  padding: 4px;
}

.keyboard-bar-row .keyboard-input-wrapper {
  flex: 1;
  min-width: 0;
  padding: 0;
}

/* ⌨ / ↵ は1/5幅、スニペットは固定44px（最右） */
.keyboard-bar-row .quick-flick-arrow,
.keyboard-bar-row .quick-flick-enter {
  flex: none;
  min-width: calc((100vw - 16px) / 5);
  width: calc((100vw - 16px) / 5);
  border-color: var(--white-30);
}

.keyboard-bar-row .snippet-toggle-btn {
  flex: none;
  min-width: 44px;
  width: 44px;
  border-color: var(--white-30);
}

.keyboard-bar-row .enter-send-mode {
  border-color: var(--accent);
}

.keyboard-bar-row .enter-disabled {
  color: var(--white-30);
  border-color: var(--white-30);
  opacity: 0.5;
}

/* ─── キーボタン共通 ───────────────────────────────────────────────────────── */
.quick-key {
  position: relative;
  height: 44px;
  min-height: 44px;
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius);
  background: rgba(40, 44, 65, 0.8);
  color: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  outline: none;
  transition: transform 0.12s ease, background 0.12s ease;
}

.quick-key.pressed {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
  transform: scale(0.85);
  transition: transform 0.06s ease, background 0.06s ease;
}

.quick-key.tap-bounce {
  animation: quick-key-bounce 0.25s ease-out;
}

@keyframes quick-key-bounce {
  0% { transform: scale(0.85); }
  50% { transform: scale(1.08); }
  100% { transform: scale(1); }
}

.quick-key-toggle.active,
.quick-modifier.active {
  background: rgb(33, 40, 60);
  color: var(--accent);
  border-color: var(--accent);
}

/* ─── Flick キー ───────────────────────────────────────────────────────────── */
.quick-flick-arrow,
.quick-flick-enter {
  position: relative;
}

.quick-flick-enter {
  flex: 1.5;
}

.quick-flick-enter .flick-main,
.quick-flick-arrow .flick-main {
  font-size: 18px;
}

.quick-flick-enter .flick-hint-top,
.quick-flick-enter .flick-hint-left,
.quick-flick-enter .flick-hint-bottom,
.quick-flick-arrow .flick-hint-top,
.quick-flick-arrow .flick-hint-left,
.quick-flick-arrow .flick-hint-right,
.quick-flick-arrow .flick-hint-bottom {
  position: absolute;
  font-size: 10px;
  color: var(--white-30);
}

.quick-flick-enter .flick-hint-top,
.quick-flick-arrow .flick-hint-top {
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
}

.quick-flick-enter .flick-hint-left,
.quick-flick-arrow .flick-hint-left {
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
}

.quick-flick-enter .flick-hint-bottom,
.quick-flick-arrow .flick-hint-bottom {
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
}

.quick-flick-arrow .flick-hint-right {
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}

/* ─── QWERTYパネル ─────────────────────────────────────────────────────────── */
.quick-extra-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  pointer-events: auto;
  padding: 4px;
  background: transparent;
}

.quick-extra-panel .quick-key {
  border-color: var(--white-30);
}

.quick-extra-row {
  display: flex;
  gap: 4px;
}

.quick-qwerty-panel {
  gap: 6px;
}

.quick-qwerty-panel .quick-extra-row {
  gap: 2px;
}

.quick-qwerty-panel .quick-key {
  border-color: var(--white-30);
}

.quick-qwerty-panel .flick-main {
  font-size: 14px;
}

.quick-qwerty-panel .quick-key-toggle.active,
.quick-qwerty-panel .quick-modifier.active {
  background: rgb(33, 40, 60);
  color: rgba(130, 170, 255, 0.8);
  border-color: rgba(130, 170, 255, 0.6);
}

.quick-qwerty-panel .keyboard-chips-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ─── スニペットチップ ─────────────────────────────────────────────────────── */
.quick-snippet-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
  flex: 1;
  min-width: 0;
  pointer-events: none;
}

.quick-snippet-row > * {
  pointer-events: auto;
}

.quick-snippet-scroll-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  pointer-events: auto;
  scrollbar-width: none;
  max-height: 40vh;
}

.quick-snippet-scroll-row::-webkit-scrollbar {
  display: none;
}

.quick-snippet-scroll-row > .quick-chip-item {
  flex: 0 0 auto;
  width: 100%;
  max-width: none;
  touch-action: pan-y;
}

.quick-chip-item {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--white-30);
  border-radius: var(--radius);
  background: rgba(40, 44, 65, 0.8);
  color: var(--text-primary);
  font-size: 9px;
  line-height: 30px;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.quick-chip-item-empty {
  display: flex;
  align-items: center;
  border-style: dashed;
  color: var(--text-muted);
  justify-content: center;
  pointer-events: none;
}

.quick-chip-item.pressed {
  background: rgba(130, 170, 255, 0.3);
  color: var(--text-primary);
  transform: scale(0.92);
  transition: transform 0.06s ease, background 0.06s ease;
}

.quick-chip-item.tap-bounce {
  animation: snippet-bounce 0.25s ease-out;
}

@keyframes snippet-bounce {
  0% { transform: scale(0.92); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

/* ─── テキスト入力 ─────────────────────────────────────────────────────────── */
.keyboard-input-wrapper {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 4px;
  gap: 6px;
}

.keyboard-input-row {
  display: flex;
  gap: 6px;
  width: 100%;
}

.keyboard-input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius);
  background: rgba(25, 28, 45, 0.95);
  color: var(--text-primary);
  font-size: 16px;
  font-family: inherit;
  box-sizing: border-box;
  outline: none;
}

.keyboard-input-send {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--white-30);
  border-radius: 50%;
  background: rgba(40, 44, 65, 0.8);
  color: var(--accent);
  font-size: 18px;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  flex-shrink: 0;
}

.keyboard-input-send:disabled {
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--white-30);
}

.keyboard-input::placeholder {
  color: var(--white-30);
}

.keyboard-input::-webkit-search-cancel-button,
.keyboard-input::-webkit-search-decoration {
  -webkit-appearance: none;
  appearance: none;
}
</style>
