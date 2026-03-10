<template>
  <template v-if="isPanelBottom">
    <div v-if="mode === 1" class="keyboard-qwerty-overlay" @click="switchToMinimum"></div>
    <div v-show="!isTextInputVisible">
      <KeyboardMinimumKey
        :active="mode === 0"
        :snippet-open="snippetOpen"
        @cycleMode="cycleMode"
      />
      <KeyboardQwertyKey
        :active="mode === 1"
        @cycleMode="cycleMode"
      />
    </div>
    <KeyboardInput
      ref="keyboardInputBar"
      @visibility="onKeyboardInputVisibility"
    />
  </template>
</template>

<script setup>
import { ref, watch, nextTick } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { emit } from "../app-bridge.js";
import KeyboardMinimumKey from "./KeyboardMinimumKey.vue";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";

defineProps({
  isPanelBottom: { type: Boolean, default: false },
});
const emitLocal = defineEmits(["visibility"]);

const { clearModifiers } = useKeyboard();

const mode = ref(0);
const snippetOpen = ref(false);
const keyboardInputBar = ref(null);
const isTextInputVisible = ref(false);

function cycleMode() {
  mode.value = (mode.value + 1) % 2;
  clearModifiers();
}

function switchToMinimum() {
  mode.value = 0;
  clearModifiers();
}

function onKeyboardInputVisibility(visible) {
  isTextInputVisible.value = !!visible;
  emitLocal("visibility", isTextInputVisible.value);
}

function showInput() {
  keyboardInputBar.value?.show?.();
}

function hideInput() {
  keyboardInputBar.value?.hide?.();
}

watch(mode, (val) => {
  nextTick(() => {
    emit("layout:fitAll");
    emit("keyboard:modeChange", { mode: val });
  });
});

defineExpose({
  mode,
  cycleMode,
  switchToMinimum,
  snippetOpen,
  keyboardInputBar,
  isTextInputVisible,
  showInput,
  hideInput,
});
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
  min-width: calc((100vw - 16px) / 5.5);
  width: calc((100vw - 16px) / 5.5);
}

.quick-input-panel.minimal-mode .quick-flick-enter {
  min-width: calc((100vw - 16px) / 5.5);
  width: calc((100vw - 16px) / 5.5);
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
  border-radius: 8px;
  background: rgba(40, 44, 65, 0.55);
  color: rgba(255, 255, 255, 0.7);
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
  background: var(--accent-bg-20);
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

.quick-qwerty-panel .quick-key-toggle.active {
  background: rgba(130, 170, 255, 0.12);
  color: rgba(130, 170, 255, 0.7);
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
  flex-direction: row;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  pointer-events: auto;
  scrollbar-width: none;
}

.quick-snippet-scroll-row::-webkit-scrollbar {
  display: none;
}

.quick-snippet-scroll-row > .quick-snippet-item {
  flex: 0 0 auto;
  width: auto;
  max-width: 160px;
  touch-action: pan-x;
}

.quick-snippet-item {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--white-30);
  border-radius: 6px;
  background: rgba(40, 44, 65, 0.55);
  color: var(--text-primary);
  font-size: 9px;
  line-height: 28px;
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

.quick-snippet-item-empty {
  display: flex;
  align-items: center;
  border-style: dashed;
  color: var(--text-muted);
  justify-content: center;
  pointer-events: none;
}

.quick-snippet-item.pressed {
  background: rgba(130, 170, 255, 0.3);
  color: var(--text-primary);
  transform: scale(0.92);
  transition: transform 0.06s ease, background 0.06s ease;
}

.quick-snippet-item.tap-bounce {
  animation: snippet-bounce 0.25s ease-out;
}

@keyframes snippet-bounce {
  0% { transform: scale(0.92); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

.keyboard-input-wrapper {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.keyboard-input-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  z-index: 9998;
}

.keyboard-qwerty-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  z-index: 20;
  pointer-events: auto;
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
  border-radius: 8px;
  background: rgba(25, 28, 40, 0.68);
  color: var(--text-primary);
  font-size: 16px;
  font-family: inherit;
  box-sizing: border-box;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
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
  border: 1px solid var(--accent);
  border-radius: 50%;
  background: rgba(25, 28, 40, 0.95);
  color: var(--accent);
  font-size: 18px;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  flex-shrink: 0;
}

.keyboard-input-add {
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--white-30);
  border-radius: 50%;
  background: rgba(25, 28, 40, 0.95);
  color: var(--text-primary);
  font-size: 20px;
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
</style>
