<template>
  <div v-show="isVisible" class="keyboard-bar">
    <KeyboardQwertyKey
      ref="qwertyView"
      :active="isFullKeyboard"
      :hide-bottom-row="true"
      :external-input-focused="inputFocused"
      :external-snippet-view="showSnippetView"
      @cycleMode="toggleKeyboard"
      @submitted="onSubmitted"
      @snippetToggle="toggleSnippetView"
    />
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
        :class="{ 'enter-send-mode': hasDraft, 'enter-disabled': inputFocused && !hasDraft }"
        ref="barEnterFlickEl"
      >
        <template v-if="hasDraft">
          <span class="flick-hint-left" style="font-size:8px">clear</span>
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onUnmounted, watch } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useLayoutStore } from "../stores/layout.js";
import { useInputStore } from "../stores/input.js";
import { useInputDraftHistory } from "../composables/useInputDraftHistory.js";
import { useKeyboardBarFlicks } from "../composables/useKeyboardBarFlicks.js";
import { on, emit } from "../app-bridge.js";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";
import KeyboardChips from "./KeyboardChips.vue";

const props = defineProps({
  isPanelBottom: { type: Boolean, default: false },
});

const layoutStore = useLayoutStore();
const inputStore = useInputStore();
const isVisible = computed(() => props.isPanelBottom || layoutStore.isSplitMode);

const { clearModifiers, sendKeyToTerminal, sendTextToTerminal, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();

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

const { historyPrev, historyNext, cycleSnippet } = useInputDraftHistory(draft, inputFocused, sendTextToTerminal);

function onInputFocused(focused) {
  inputFocused.value = !!focused;
}

function toggleSnippetView() {
  showSnippetView.value = !showSnippetView.value;
  if (showSnippetView.value) clearModifiers();
}
function doRefresh() {
  const tab = getActiveTerminalTab();
  if (tab) emit("tab:refresh", { tab });
}
function doReload() {
  window.location.replace(window.location.pathname + "?_=" + Date.now());
}

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
  if (inputFocused.value) {
    keyboardInput.value?.blur?.();
    inputFocused.value = false;
    clearModifiers();
    return;
  }
  if (isFullKeyboard.value) {
    isFullKeyboard.value = false;
    clearModifiers();
    return;
  }
  isFullKeyboard.value = true;
  showSnippetView.value = false;
  clearModifiers();
}

function onSubmitted() {
  hideInput();
}

useKeyboardBarFlicks({
  arrowEl: barArrowFlickEl, enterEl: barEnterFlickEl,
  inputFocused, hasDraft, draft, keyboardInput,
  cycleSnippet, historyPrev, historyNext,
  setupFlickRepeat, sendKeyToTerminal, dismissKeyboard,
});

const cleanups = [
  on("keyboard:activate", showInput),
  on("keyboard:deactivate", hideInput),
];
onUnmounted(() => cleanups.forEach((fn) => fn()));

// 入力モード切替で keyboard-bar の高さが変わると terminal 領域も縮む / 広がる。
// ResizeObserver の debounce を待たず、即座に fit を要求して旧サイズでの描画を最小化する。
watch([isFullKeyboard, inputFocused, showSnippetView], async () => {
  await nextTick();
  emit("layout:fitAll", { force: true });
});
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
  flex: 3;
  min-width: 0;
  padding: 0;
}

.keyboard-bar-row .quick-flick-arrow,
.keyboard-bar-row .quick-flick-enter {
  flex: 1;
  min-width: 0;
  width: auto;
  border-color: var(--white-30);
}


.keyboard-bar-row .quick-key-toggle.active {
  background: rgb(33, 40, 60);
  border-color: rgba(130, 170, 255, 0.7);
  color: rgba(130, 170, 255, 0.9);
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
  font-size: 12px;
}

.quick-qwerty-panel .flick-main {
  font-size: 14px;
}

.quick-qwerty-panel .flick-main-text {
  font-size: 11px;
}

.quick-qwerty-panel .flick-hint-active {
  color: rgba(130, 170, 255, 0.9);
}

.quick-qwerty-panel .quick-modifier {
  background: rgba(40, 44, 65, 0.8);
  border-color: var(--white-30);
  color: rgba(255, 255, 255, 0.8);
}

.quick-qwerty-panel .quick-key-toggle.active,
.quick-qwerty-panel .quick-modifier.active {
  background: rgb(33, 40, 60);
  color: rgba(130, 170, 255, 0.9);
  border-color: rgba(130, 170, 255, 0.7);
}

.quick-fn-key {
  font-size: 12px;
}

.quick-qwerty-panel .keyboard-chips-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-extra-bottom-keys .keyboard-input-wrapper {
  flex: 3;
  min-width: 0;
}

.quick-extra-bottom-keys .quick-key {
  flex: 1;
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
