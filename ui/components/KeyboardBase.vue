<template>
  <template v-if="isKeyboardVisible">
    <div :class="['keyboard-tap-backdrop', isFullKeyboard ? 'tap-backdrop-full' : 'tap-backdrop-mini']"></div>
    <KeyboardMinimumKey
      :active="!isFullKeyboard"
      @cycleMode="toggleKeyboard"
    />
    <KeyboardQwertyKey
      ref="qwertyView"
      :active="isFullKeyboard"
      @cycleMode="toggleKeyboard"
      @submitted="hideInput"
      @inputFocus="onInputFocus"
    />
  </template>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useLayoutStore } from "../stores/layout.js";
import { useViewport } from "../composables/useViewport.js";
import { on } from "../app-bridge.js";
import KeyboardMinimumKey from "./KeyboardMinimumKey.vue";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";

const props = defineProps({
  isPanelBottom: { type: Boolean, default: false },
});
const layoutStore = useLayoutStore();
const isKeyboardVisible = computed(() => props.isPanelBottom || layoutStore.isSplitMode);

const { clearModifiers } = useKeyboard();

const isFullKeyboard = ref(false);
const qwertyView = ref(null);
const { keyboardOpen } = useViewport();

function showInput() {
  isFullKeyboard.value = true;
  nextTick(() => qwertyView.value?.focusInput?.());
}

function hideInput() {
  isFullKeyboard.value = false;
  clearModifiers();
}

function toggleKeyboard() {
  // input にフォーカスがあったまま切り替えると inputFocused = true のままで
  // QWERTY rows が表示されないので、ここで強制的に blur する。
  qwertyView.value?.blurInput?.();
  isFullKeyboard.value = !isFullKeyboard.value;
  clearModifiers();
}

// inputFocus イベントは子側で QWERTY rows / メタキー段の表示制御に使われる。
// blur 時にモードを Minimum に戻すことはしない (ユーザーが明示的に切り替えるまで QWERTY のまま)。
function onInputFocus() {}

// OS キーボードの開閉が visualViewport で検知できる場合の経路:
// 開いたら showInput、閉じたら ×ボタンと同じ処理 (toggleKeyboard) でモードを抜ける。
watch(keyboardOpen, (open) => {
  if (open) {
    if (document.querySelector(".modal-overlay")) return;
    showInput();
  } else if (isFullKeyboard.value) {
    toggleKeyboard();
  }
});

const cleanups = [
  on("keyboard:activate", showInput),
  on("keyboard:deactivate", hideInput),
];
onUnmounted(() => cleanups.forEach((fn) => fn()));

defineExpose({ isFullKeyboard, toggleKeyboard, showInput, hideInput });
</script>

<style>
.quick-input {
  position: absolute;
  bottom: 0;
  right: 0;
  left: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding-bottom: 4px;
  pointer-events: none;
}

.quick-input > * {
  pointer-events: auto;
}

.quick-input-panel {
  display: flex;
  flex-direction: row;
  gap: 4px;
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 30;
  pointer-events: auto;
  padding: 4px;
}

.quick-input-panel.minimal-mode {
  gap: 2px;
}

.quick-input-panel.minimal-mode .quick-key {
  flex: none;
  min-width: calc((100vw - 16px) / 5);
  width: calc((100vw - 16px) / 5);
}

.quick-qwerty-panel .quick-extra-bottom-keys .quick-flick-enter {
  flex: 1;
}

.quick-qwerty-panel .quick-extra-bottom-keys .flick-main {
  font-size: 18px;
}

.quick-qwerty-panel .quick-extra-bottom-keys .quick-key {
  flex: none;
  min-width: calc((100vw - 16px) / 5);
  width: calc((100vw - 16px) / 5);
}

.quick-qwerty-panel .quick-extra-bottom-keys .snippet-toggle-btn {
  flex: none;
  min-width: 40px;
  width: 40px;
  background: rgba(40, 44, 65, 0.8);
  border: 1px solid var(--white-30);
  color: rgba(255, 255, 255, 0.8);
}

.quick-qwerty-panel .quick-extra-bottom-keys > .keyboard-input-wrapper {
  flex: none;
  width: calc((100vw - 16px) * 3 / 5 - 42px);
  margin-right: auto;
  min-width: 0;
  padding: 0;
}

.quick-qwerty-panel .keyboard-chips-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-qwerty-panel .enter-send-mode {
  border-color: var(--accent);
}

.quick-qwerty-panel .enter-disabled {
  color: var(--white-30);
  border-color: var(--white-30);
  opacity: 0.5;
}

.quick-extra-panel {
  bottom: 100%;
}

.quick-input-panel.minimal-mode.snippet-open {
  flex: 1;
  width: auto;
  margin-left: 0;
}

.quick-input-panel.minimal-mode.snippet-open .quick-flick-enter {
  flex: 1;
}

.quick-flick-arrow,
.quick-flick-enter {
  position: relative;
}

.quick-flick-enter {
  flex: 1.5;
}

.quick-input-panel.extra-open {
  position: static;
  width: 100%;
  padding: 0;
}

.quick-input-panel.extra-open .quick-key-toggle,
.quick-input-panel.extra-open .quick-flick-enter {
  flex: 1;
}

.quick-flick-enter .flick-main,
.quick-flick-arrow .flick-main {
  font-size: 18px;
}

.quick-flick-enter .flick-hint-top,
.quick-flick-enter .flick-hint-left,
.quick-flick-enter .flick-hint-bottom {
  position: absolute;
  font-size: 10px;
  color: var(--white-30);
}

.quick-flick-enter .flick-hint-top {
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
}

.quick-flick-enter .flick-hint-left {
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
}

.quick-flick-enter .flick-hint-bottom {
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
}

.quick-flick-arrow .flick-hint-top,
.quick-flick-arrow .flick-hint-left,
.quick-flick-arrow .flick-hint-right,
.quick-flick-arrow .flick-hint-bottom {
  position: absolute;
  font-size: 10px;
  color: var(--white-30);
}

.quick-flick-arrow .flick-hint-top {
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
}

.quick-flick-arrow .flick-hint-left {
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
}

.quick-flick-arrow .flick-hint-right {
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}

.quick-flick-arrow .flick-hint-bottom {
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
}

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

.quick-hard-reload {
  font-size: 20px;
}

.quick-local-storage-clear {
  font-size: 20px;
  color: rgba(255, 120, 120, 0.8);
}

.quick-workspace-modal-open {
  font-size: 20px;
  color: var(--accent);
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

.quick-extra-panel .quick-key {
  border-color: var(--white-30);
}

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
  border-top: none;
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

.quick-minimal-snippet-wrap {
  display: flex;
  width: 100%;
  min-width: 0;
  pointer-events: none;
}

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
  border: 1px solid var(--white-30);
  border-radius: var(--radius);
  background: rgba(40, 44, 65, 0.8);
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

.keyboard-input-snippets {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 5px;
  pointer-events: auto;
}

.snippet-chip-icon {
  font-size: 13px;
  margin-right: 4px;
  opacity: 0.6;
  flex-shrink: 0;
}

@media (min-width: 769px) {
  .quick-input {
    display: none !important;
  }
  .main-panel.panel-bottom .quick-input {
    display: flex !important;
  }
}

.pwa .main-panel.panel-bottom .quick-input {
  padding-bottom: 28px;
}

/* ─── Keyboard panel position offsets (per layout mode) ────────────────────
 * パネル位置は以下の3つに集約:
 * - デフォルト: .quick-input-panel が bottom: 0
 * - panel-bottom モード: status bar + tab bar + safe area を避けて 122px
 * - split mode: 簡略化された下部余白で 24px
 */
.main-panel.panel-bottom .main-panel-keyboard-overlay .quick-input-panel,
.main-panel.panel-bottom .main-panel-keyboard-overlay .quick-qwerty-panel {
  bottom: 122px;
}

.main-panel.split-mode .main-panel-keyboard-overlay .quick-input-panel,
.main-panel.split-mode .main-panel-keyboard-overlay .quick-qwerty-panel {
  bottom: 24px;
}

/* キーとキーの間のタップを吸収するための透明 backdrop。z-indexはpanel(30)より低くキーの押下は妨げない */
.keyboard-tap-backdrop {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: auto;
  background: transparent;
  z-index: 25;
}

.tap-backdrop-mini {
  left: auto;
  width: calc(2 * (100vw - 16px) / 5 + 12px);
  height: 52px;
}

.tap-backdrop-full {
  height: 260px;
}

.main-panel.panel-bottom .keyboard-tap-backdrop {
  bottom: 122px;
}

.main-panel.split-mode .keyboard-tap-backdrop {
  bottom: 24px;
}
</style>
