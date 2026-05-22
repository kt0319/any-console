<template>
  <div v-show="active" class="quick-extra-panel quick-qwerty-panel">
    <input
      ref="cameraInputEl"
      type="file"
      accept="image/*"
      style="display:none"
      @change="onCameraFileChange"
    />
    <div class="keyboard-chips-row">
      <KeyboardChips :insert-mode="true" @chip:tap="onChipTap" />
    </div>
    <div v-show="!inputFocused" v-for="(row, ri) in qwertyRows" :key="ri" class="quick-extra-row">
      <div
        v-for="(keyDef, ci) in row"
        :key="ci"
        class="quick-key"
        :class="{ 'quick-flick-arrow': hasFlick(ri, ci, keyDef) }"
        @touchstart.prevent="onQwertyTouchStart($event, keyDef)"
        @touchend.prevent="onQwertyTouchEnd($event, keyDef, ri, ci)"
        @touchcancel="onQuickKeyCancel($event)"
      >
        <template v-if="hasFlick(ri, ci, keyDef)">
          <span v-if="flickUpLabel(ri, ci, keyDef)" class="flick-hint-top">{{ flickUpLabel(ri, ci, keyDef) }}</span>
          <span class="flick-main">{{ displayLabel(keyDef) }}</span>
          <span v-if="keyDef.flickDown" class="flick-hint-bottom">{{ keyDef.flickDown }}</span>
        </template>
        <template v-else>{{ displayLabel(keyDef) }}</template>
      </div>
      <div
        v-if="ri === 2"
        class="quick-key quick-flick-arrow"
        @touchstart.prevent="onCameraTouchStart"
        @touchend.prevent="onCameraTouchEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="openCamera"
      >
        <span class="flick-hint-top"><span class="mdi mdi-refresh" style="font-size:10px"></span></span>
        <span class="flick-main"><span class="mdi mdi-camera"></span></span>
        <span class="flick-hint-bottom"><span class="mdi mdi-pin" style="font-size:10px"></span></span>
      </div>
    </div>
    <div v-show="!inputFocused" class="quick-extra-row quick-extra-modifier-keys">
      <div
        class="quick-key quick-flick-arrow quick-modifier"
        :class="{ active: modifierState.shift }"
        @touchstart.prevent="onShiftTouchStart"
        @touchend.prevent="onShiftTouchEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="toggleShift"
      >
        <span class="flick-hint-top">Esc</span>
        <span class="flick-hint-left">^U</span>
        <span class="flick-main"><span class="mdi mdi-arrow-up-bold"></span></span>
        <span class="flick-hint-right">^K</span>
      </div>
      <div
        class="quick-key quick-flick-arrow"
        @touchstart.prevent="onSpaceTouchStart"
        @touchend.prevent="onSpaceTouchEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="sendSpace"
      >
        <span class="flick-hint-top">PgU</span>
        <span class="flick-hint-left">Home</span>
        <span class="flick-main">&blank;</span>
        <span class="flick-hint-right">End</span>
        <span class="flick-hint-bottom">PgD</span>
      </div>
      <div
        class="quick-key quick-flick-arrow quick-modifier"
        :class="{ active: modifierState.ctrl }"
        @touchstart.prevent="onCtrlTouchStart"
        @touchend.prevent="onCtrlTouchEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="toggleCtrl"
      >
        <span class="flick-hint-top">^C</span>
        <span class="flick-hint-left">^L</span>
        <span class="flick-main">&Hat;</span>
        <span class="flick-hint-right">^R</span>
        <span class="flick-hint-bottom">^O</span>
      </div>
    </div>
    <div class="quick-extra-row quick-extra-bottom-keys">
      <KeyboardInput ref="keyboardInput" v-model:draft="draft" @focused="onInputFocused" @submitted="$emit('submitted')" />
      <div class="quick-key quick-flick-arrow quick-key-toggle active" ref="topArrowFlickEl">
        <span class="flick-hint-top">&uarr;</span>
        <span class="flick-hint-left">&larr;</span>
        <span class="flick-main"><span class="mdi mdi-close"></span></span>
        <span class="flick-hint-right">&rarr;</span>
        <span class="flick-hint-bottom">&darr;</span>
      </div>
      <div
        class="quick-key quick-flick-enter quick-flick-arrow quick-key-toggle"
        :class="{ 'enter-send-mode': inputFocused && hasDraft, 'enter-disabled': inputFocused && !hasDraft }"
        ref="topEnterFlickEl"
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { usePrompt } from "../composables/usePrompt.js";
import { useInputStore } from "../stores/input.js";
import { useAuthStore } from "../stores/auth.js";
import { emit, on } from "../app-bridge.js";
import { FLICK_THRESHOLD, REPEAT_DELAY, REPEAT_INTERVAL, MIN_REPEAT_INTERVAL, REPEAT_ACCELERATION } from "../utils/constants.js";
import { arrowResolver, enterResolver } from "../utils/flick-resolvers.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import KeyboardInput from "./KeyboardInput.vue";
import KeyboardChips from "./KeyboardChips.vue";

const props = defineProps({
  active: { type: Boolean, default: false },
});

const emitLocal = defineEmits(["cycleMode", "submitted", "inputFocus"]);

const keyboardInput = ref(null);
const inputFocused = ref(false);
const draft = ref("");
const hasDraft = computed(() => draft.value.trim().length > 0);

let historyIndex = -1;
let savedDraft = "";
function historyPrev() {
  const list = inputStore.inputHistory;
  if (!list.length) return;
  if (historyIndex === -1) savedDraft = draft.value;
  historyIndex = Math.min(historyIndex + 1, list.length - 1);
  draft.value = list[historyIndex];
}
function historyNext() {
  if (historyIndex === -1) return;
  const list = inputStore.inputHistory;
  historyIndex -= 1;
  if (historyIndex < 0) {
    historyIndex = -1;
    draft.value = savedDraft;
    return;
  }
  draft.value = list[historyIndex];
}

watch(draft, (val) => {
  if (val === "") historyIndex = -1;
});

function focusInput() {
  keyboardInput.value?.focus?.();
}

function blurInput() {
  keyboardInput.value?.blur?.();
}

function onInputFocused(focused) {
  inputFocused.value = !!focused;
  emitLocal("inputFocus", !!focused);
}

function onChipTap({ command }) {
  if (inputFocused.value) {
    draft.value = command;
    keyboardInput.value?.focus?.();
  } else {
    sendTextToTerminal(command);
    inputStore.addInputHistory(command);
  }
}

defineExpose({ focusInput, blurInput });

const inputStore = useInputStore();
const auth = useAuthStore();
const { sendKeyToTerminal, sendTextToTerminal, modifierState, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();
const { prompt } = usePrompt();

const topArrowFlickEl = ref(null);
const topEnterFlickEl = ref(null);
const cameraInputEl = ref(null);

const qwertyRows = computed(() => inputStore.QWERTY_ROWS || []);
const numberKeys = computed(() => inputStore.NUMBER_KEYS || []);

function displayLabel(keyDef) {
  if (modifierState.shift && keyDef.key?.length === 1) return keyDef.key.toUpperCase();
  return keyDef.label || keyDef.key;
}

function hasFlick(ri, ci, keyDef) {
  return (ri === 0 && ci < (numberKeys.value?.length || 0)) || !!keyDef.flickUp || !!keyDef.flickDown;
}

function flickUpLabel(ri, ci, keyDef) {
  if (ri === 0 && ci < (numberKeys.value?.length || 0)) return numberKeys.value[ci]?.label;
  return keyDef.flickUp || "";
}

function onQuickKeyCancel(e) {
  e.currentTarget.classList.remove("pressed");
}

function onQwertyTouchStart(e) {
  e.currentTarget.classList.add("pressed");
  e.currentTarget._touchStartY = e.touches[0].clientY;
}

function sendOrType(keyObj) {
  // input にフォーカスがあるときは input の draft へ。それ以外はターミナルへ。
  if (keyboardInput.value?.isFocused?.()) {
    const k = keyObj.key;
    if (k === "Enter") { keyboardInput.value?.submit?.(); return; }
    if (k === "Backspace") { keyboardInput.value?.backspace?.(); return; }
    if (typeof k === "string" && k.length === 1 && !keyObj.ctrl) {
      const ch = (modifierState.shift && /[a-z]/.test(k)) ? k.toUpperCase() : k;
      keyboardInput.value?.appendChar?.(ch);
      return;
    }
    // 制御キー (Ctrl 修飾やファンクション類) はターミナルへ流す
  }
  sendKeyToTerminal(keyObj);
}

function onQwertyTouchEnd(e, keyDef, ri, ci) {
  e.currentTarget.classList.remove("pressed");
  const dy = e.changedTouches[0].clientY - (e.currentTarget._touchStartY || 0);
  if (hasFlick(ri, ci, keyDef) && dy < -30) {
    const upKey = ri === 0 && ci < numberKeys.value.length
      ? numberKeys.value[ci]
      : { key: keyDef.flickUp, label: keyDef.flickUp };
    if (upKey) sendOrType(upKey);
    return;
  }
  if (keyDef.flickDown && dy > 30) {
    sendOrType({ key: keyDef.flickDown, label: keyDef.flickDown });
    return;
  }
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendOrType(merged);
}


let cameraStartY = 0;
function onCameraTouchStart(e) {
  e.currentTarget.classList.add("pressed");
  cameraStartY = e.touches[0].clientY;
}
async function onCameraTouchEnd(e) {
  e.currentTarget.classList.remove("pressed");
  const dy = e.changedTouches[0].clientY - cameraStartY;
  if (dy < -FLICK_THRESHOLD) {
    doReload();
    return;
  }
  if (dy > FLICK_THRESHOLD) {
    const cmd = await prompt({
      title: "Save Snippet",
      message: "Enter command to save as snippet.",
      initialValue: "",
      placeholder: "echo hello",
    });
    if (cmd) emit("snippet:add", { command: cmd });
    return;
  }
  openCamera();
}

function doReload() {
  emitLocal("cycleMode");
  window.location.replace(window.location.pathname + "?_=" + Date.now());
}
function openCamera() {
  const el = cameraInputEl.value;
  if (!el) return;
  el.value = "";
  el.click();
}

async function uploadImageAndSendPath(file) {
  if (!file) return;
  const tab = getActiveTerminalTab();
  await uploadImageToTerminal({
    file,
    apiFetch: auth.apiFetch.bind(auth),
    ws: tab?.ws,
    notify: (message, type) => emit("toast:show", { message, type }),
  });
}

async function onCameraFileChange(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  emitLocal("cycleMode");
  await uploadImageAndSendPath(file);
}

let shiftStartX = 0;
let shiftStartY = 0;
function onShiftTouchStart(e) {
  e.currentTarget.classList.add("pressed");
  shiftStartX = e.touches[0].clientX;
  shiftStartY = e.touches[0].clientY;
}
function onShiftTouchEnd(e) {
  e.currentTarget.classList.remove("pressed");
  const dx = e.changedTouches[0].clientX - shiftStartX;
  const dy = e.changedTouches[0].clientY - shiftStartY;
  if (Math.abs(dy) > Math.abs(dx) && dy < -FLICK_THRESHOLD) {
    sendKeyToTerminal({ key: "Escape" });
  } else if (Math.abs(dx) > Math.abs(dy) && dx < -FLICK_THRESHOLD) {
    sendKeyToTerminal({ key: "u", ctrl: true });
  } else if (Math.abs(dx) > Math.abs(dy) && dx > FLICK_THRESHOLD) {
    sendKeyToTerminal({ key: "k", ctrl: true });
  } else {
    toggleShift();
  }
}
function toggleShift() {
  modifierState.shift = !modifierState.shift;
}

let ctrlStartX = 0;
let ctrlStartY = 0;
function onCtrlTouchStart(e) {
  e.currentTarget.classList.add("pressed");
  ctrlStartX = e.touches[0].clientX;
  ctrlStartY = e.touches[0].clientY;
}
function onCtrlTouchEnd(e) {
  e.currentTarget.classList.remove("pressed");
  const dx = e.changedTouches[0].clientX - ctrlStartX;
  const dy = e.changedTouches[0].clientY - ctrlStartY;
  if (Math.abs(dy) > Math.abs(dx) && dy < -FLICK_THRESHOLD) {
    sendKeyToTerminal({ key: "c", ctrl: true });
  } else if (Math.abs(dy) > Math.abs(dx) && dy > FLICK_THRESHOLD) {
    sendKeyToTerminal({ key: "o", ctrl: true });
  } else if (Math.abs(dx) > Math.abs(dy) && dx < -FLICK_THRESHOLD) {
    sendKeyToTerminal({ key: "l", ctrl: true });
  } else if (Math.abs(dx) > Math.abs(dy) && dx > FLICK_THRESHOLD) {
    sendKeyToTerminal({ key: "r", ctrl: true });
  } else {
    toggleCtrl();
  }
}
function toggleCtrl() {
  modifierState.ctrl = !modifierState.ctrl;
}

let spaceStartX = 0;
let spaceStartY = 0;
function onSpaceTouchStart(e) {
  e.currentTarget.classList.add("pressed");
  spaceStartX = e.touches[0].clientX;
  spaceStartY = e.touches[0].clientY;
}
function onSpaceTouchEnd(e) {
  e.currentTarget.classList.remove("pressed");
  const dx = e.changedTouches[0].clientX - spaceStartX;
  const dy = e.changedTouches[0].clientY - spaceStartY;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
    sendKeyToTerminal(dx < 0 ? { key: "Home" } : { key: "End" });
  } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > FLICK_THRESHOLD) {
    sendKeyToTerminal(dy < 0 ? { key: "PageUp" } : { key: "PageDown" });
  } else {
    sendSpace();
  }
}
function sendSpace() {
  sendKeyToTerminal({ key: " " });
}


onMounted(() => {
  if (topArrowFlickEl.value) {
    let arrowFlickHandled = false;
    let cursorRepeatKey = null;
    let cursorRepeatTimer = null;
    const cursorStopRepeat = () => {
      if (cursorRepeatTimer !== null) { clearTimeout(cursorRepeatTimer); cursorRepeatTimer = null; }
      cursorRepeatKey = null;
    };
    const cursorScheduleRepeat = (delta, interval) => {
      cursorRepeatTimer = setTimeout(() => {
        keyboardInput.value?.moveCursor?.(delta);
        cursorScheduleRepeat(delta, Math.max(MIN_REPEAT_INTERVAL, interval - REPEAT_ACCELERATION));
      }, interval);
    };
    topArrowFlickEl.value.addEventListener("touchstart", () => {
      arrowFlickHandled = false;
      cursorStopRepeat();
    }, { passive: true });
    topArrowFlickEl.value.addEventListener("touchend", cursorStopRepeat);
    topArrowFlickEl.value.addEventListener("touchcancel", cursorStopRepeat);
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
    setupFlickRepeat(topArrowFlickEl.value, arrowResolver, () => {
      emitLocal("cycleMode");
    }, { accelerateRepeat: true, onFlick: onArrowFlick });
  }
  if (topEnterFlickEl.value) {
    const enterFlickResolver = (dx, dy, threshold) => {
      if (inputFocused.value) return null;
      return enterResolver(dx, dy, threshold);
    };
    setupFlickRepeat(topEnterFlickEl.value, enterFlickResolver, () => {
      if (inputFocused.value) {
        if (hasDraft.value) keyboardInput.value?.submit?.();
        return;
      }
      sendKeyToTerminal({ key: "Enter" });
    }, { accelerateRepeat: true });
  }
});

let offSnippetTap = null;
onMounted(() => {
  offSnippetTap = on("snippet:tap", () => {
    if (props.active) emitLocal("cycleMode");
  });
});
onUnmounted(() => { offSnippetTap?.(); });

</script>
