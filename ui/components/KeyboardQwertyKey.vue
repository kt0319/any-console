<template>
  <div v-show="active" class="quick-extra-panel quick-qwerty-panel">
    <input
      ref="cameraInputEl"
      type="file"
      accept="image/*"
      style="display:none"
      @change="onCameraFileChange"
    />
    <KeyboardSnippet ref="qwertyKeyboardSnippet" />
    <div v-for="(row, ri) in qwertyRows" :key="ri" class="quick-extra-row">
      <div
        v-for="(keyDef, ci) in row"
        :key="ci"
        class="quick-key"
        :class="{ 'quick-flick-arrow': hasFlick(ri, ci, keyDef) }"
        @touchstart.prevent="onQwertyTouchStart($event, keyDef)"
        @touchend.prevent="onQwertyTouchEnd($event, keyDef, ri, ci)"
        @touchcancel="onQuickKeyCancel($event)"
        @mouseup="onQwertyMouseUp($event, keyDef)"
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
    <div class="quick-extra-row quick-extra-bottom-keys">
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
      <div class="quick-key quick-flick-arrow quick-key-toggle active" ref="topArrowFlickEl">
        <span class="flick-hint-top">&uarr;</span>
        <span class="flick-hint-left">&larr;</span>
        <span class="flick-main"><span class="mdi mdi-close"></span></span>
        <span class="flick-hint-right">&rarr;</span>
        <span class="flick-hint-bottom">&darr;</span>
      </div>
      <div class="quick-key quick-flick-enter quick-flick-arrow quick-key-toggle" ref="topEnterFlickEl">
        <span class="flick-hint-top">Tab</span>
        <span class="flick-hint-left">BS</span>
        <span class="flick-main">&crarr;</span>
        <span class="flick-hint-bottom">Space</span>
        <span class="flick-hint-right">Del</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import KeyboardSnippet from "./KeyboardSnippet.vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useInputStore } from "../stores/input.js";
import { useAuthStore } from "../stores/auth.js";
import { emit, on } from "../app-bridge.js";
import { FLICK_THRESHOLD } from "../utils/constants.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";

const props = defineProps({
  active: { type: Boolean, default: false },
});

const emitLocal = defineEmits(["cycleMode"]);

const inputStore = useInputStore();
const auth = useAuthStore();
const { sendKeyToTerminal, modifierState, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();

const qwertyKeyboardSnippet = ref(null);
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

function onQwertyTouchEnd(e, keyDef, ri, ci) {
  e.currentTarget.classList.remove("pressed");
  const dy = e.changedTouches[0].clientY - (e.currentTarget._touchStartY || 0);
  if (hasFlick(ri, ci, keyDef) && dy < -30) {
    const upKey = ri === 0 && ci < numberKeys.value.length
      ? numberKeys.value[ci]
      : { key: keyDef.flickUp, label: keyDef.flickUp };
    if (upKey) sendKeyToTerminal(upKey);
    return;
  }
  if (keyDef.flickDown && dy > 30) {
    sendKeyToTerminal({ key: keyDef.flickDown, label: keyDef.flickDown });
    return;
  }
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendKeyToTerminal(merged);
}

function onQwertyMouseUp(e, keyDef) {
  if (e.button !== 0) return;
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendKeyToTerminal(merged);
}

let cameraStartY = 0;
function onCameraTouchStart(e) {
  e.currentTarget.classList.add("pressed");
  cameraStartY = e.touches[0].clientY;
}
function onCameraTouchEnd(e) {
  e.currentTarget.classList.remove("pressed");
  const dy = e.changedTouches[0].clientY - cameraStartY;
  if (dy < -FLICK_THRESHOLD) {
    emitLocal("cycleMode");
    window.location.href = window.location.pathname + "?_=" + Date.now();
  } else if (dy > FLICK_THRESHOLD) {
    const cmd = prompt("Save as snippet:");
    if (cmd) emit("snippet:add", { command: cmd });
  } else {
    openCamera();
  }
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

const arrowResolver = (dx, dy, threshold) => {
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
    return dx < 0 ? { key: "ArrowLeft" } : { key: "ArrowRight" };
  }
  if (Math.abs(dy) > threshold && dy < 0) return { key: "ArrowUp" };
  if (Math.abs(dy) > threshold && dy > 0) return { key: "ArrowDown" };
  return null;
};

const enterResolver = (dx, dy, threshold) => {
  if (Math.abs(dy) > Math.abs(dx) && dy < -threshold) return { key: "Tab" };
  if (Math.abs(dy) > Math.abs(dx) && dy > threshold) return { key: " " };
  if (Math.abs(dx) > Math.abs(dy) && dx < -threshold) return { key: "Backspace" };
  if (Math.abs(dx) > Math.abs(dy) && dx > threshold) return { key: "Delete" };
  return null;
};

onMounted(() => {
  if (topArrowFlickEl.value) {
    setupFlickRepeat(topArrowFlickEl.value, arrowResolver, () => {
      emitLocal("cycleMode");
    }, { accelerateRepeat: true });
  }
  if (topEnterFlickEl.value) {
    setupFlickRepeat(topEnterFlickEl.value, enterResolver, () => {
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

watch(() => props.active, (val) => {
  if (val) {
    nextTick(() => qwertyKeyboardSnippet.value?.show());
  }
});
</script>
