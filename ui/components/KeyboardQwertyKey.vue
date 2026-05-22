<template>
  <div v-show="active" class="quick-extra-panel quick-qwerty-panel">
    <input
      ref="cameraInputEl"
      type="file"
      accept="image/*"
      style="display:none"
      @change="onCameraFileChange"
    />
    <div v-show="showSnippetView" class="keyboard-chips-row">
      <KeyboardChips :insert-mode="true" @chip:tap="onChipTap" />
    </div>
    <div v-show="!inputFocused && !showSnippetView" v-for="(row, ri) in qwertyRows" :key="ri" class="quick-extra-row">
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
    </div>
    <div v-show="!inputFocused && !showSnippetView" class="quick-extra-row quick-extra-modifier-keys">
      <div
        class="quick-key quick-flick-arrow quick-modifier"
        :class="{ active: modifierState.shift }"
        @touchstart.prevent="shiftFlick.onStart"
        @touchend.prevent="shiftFlick.onEnd"
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
        @touchstart.prevent="spaceFlick.onStart"
        @touchend.prevent="spaceFlick.onEnd"
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
        @touchstart.prevent="ctrlFlick.onStart"
        @touchend.prevent="ctrlFlick.onEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="toggleCtrl"
      >
        <span class="flick-hint-top">^C</span>
        <span class="flick-hint-left">^L</span>
        <span class="flick-main">&Hat;</span>
        <span class="flick-hint-right">^R</span>
        <span class="flick-hint-bottom">^O</span>
      </div>
      <div
        class="quick-key quick-flick-arrow"
        @touchstart.prevent="cameraFlick.onStart"
        @touchend.prevent="cameraFlick.onEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="openCamera"
      >
        <span class="flick-hint-top"><span class="mdi mdi-refresh" style="font-size:10px"></span></span>
        <span class="flick-main"><span class="mdi mdi-camera"></span></span>
      </div>
    </div>
    <div class="quick-extra-row quick-extra-bottom-keys">
      <KeyboardInput ref="keyboardInput" v-model:draft="draft" @focused="onInputFocused" @submitted="$emit('submitted')" />
      <div
        class="quick-key snippet-toggle-btn quick-modifier quick-flick-arrow"
        :class="{ active: showSnippetView }"
        @touchstart.prevent="snippetFlick.onStart"
        @touchend.prevent="snippetFlick.onEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="toggleSnippetView"
      >
        <span class="flick-hint-top">Add</span>
        <span class="flick-main"><span class="mdi mdi-bookmark-multiple"></span></span>
      </div>
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
import { REPEAT_DELAY, REPEAT_INTERVAL, MIN_REPEAT_INTERVAL, REPEAT_ACCELERATION } from "../utils/constants.js";
import { arrowResolver, enterResolver } from "../utils/flick-resolvers.js";
import { createFlickHandlers } from "../utils/flick-handlers.js";
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
const showSnippetView = ref(false);

function toggleSnippetView() {
  showSnippetView.value = !showSnippetView.value;
}
async function askAddSnippet() {
  const command = await prompt({
    title: "Save Snippet",
    message: "Enter command to save as snippet.",
    initialValue: "",
    placeholder: "echo hello",
  });
  if (!command) return;
  emit("snippet:add", { command });
}
const snippetFlick = createFlickHandlers({ up: askAddSnippet, tap: toggleSnippetView });

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
  showSnippetView.value = false;
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


const cameraFlick = createFlickHandlers({ up: () => doReload(), tap: () => openCamera() });

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

function toggleShift() { modifierState.shift = !modifierState.shift; }
function toggleCtrl() { modifierState.ctrl = !modifierState.ctrl; }
function sendSpace() { sendKeyToTerminal({ key: " " }); }

const shiftFlick = createFlickHandlers({
  up: () => sendKeyToTerminal({ key: "Escape" }),
  left: () => sendKeyToTerminal({ key: "u", ctrl: true }),
  right: () => sendKeyToTerminal({ key: "k", ctrl: true }),
  tap: toggleShift,
});

const ctrlFlick = createFlickHandlers({
  up: () => sendKeyToTerminal({ key: "c", ctrl: true }),
  down: () => sendKeyToTerminal({ key: "o", ctrl: true }),
  left: () => sendKeyToTerminal({ key: "l", ctrl: true }),
  right: () => sendKeyToTerminal({ key: "r", ctrl: true }),
  tap: toggleCtrl,
});

const spaceFlick = createFlickHandlers({
  up: () => sendKeyToTerminal({ key: "PageUp" }),
  down: () => sendKeyToTerminal({ key: "PageDown" }),
  left: () => sendKeyToTerminal({ key: "Home" }),
  right: () => sendKeyToTerminal({ key: "End" }),
  tap: sendSpace,
});


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
        if (cursorRepeatKey === null) return;
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
