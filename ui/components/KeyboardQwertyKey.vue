<template>
  <div v-show="active" class="quick-extra-panel quick-qwerty-panel">
    <input
      ref="cameraInputEl"
      type="file"
      accept="image/*"
      style="display:none"
      @change="onCameraFileChange"
    />
    <div v-if="showSnippetView && !inputFocused" class="keyboard-chips-row">
      <KeyboardChips :insert-mode="true" @chip:tap="onChipTap" />
    </div>
    <template v-if="showFnView && !inputFocused">
      <div class="quick-extra-row">
        <div
          v-for="keyDef in numberKeys" :key="keyDef.key"
          class="quick-key quick-fn-key quick-flick-arrow"
          @touchstart.prevent="onFnNumberTouchStart"
          @touchend.prevent="(e) => onFnNumberTouchEnd(e, keyDef)"
          @touchcancel="onQuickKeyCancel($event)"
          @click="sendKeyToTerminal({ key: keyDef.key })"
        >
          <span class="flick-hint-top">{{ keyDef.flickUp }}</span>
          <span class="flick-main">{{ keyDef.label }}</span>
        </div>
      </div>
      <div class="quick-extra-row">
        <div v-for="navKey in navKeys" :key="navKey.key" class="quick-key quick-fn-key" @touchstart.prevent @touchend.prevent="sendKeyToTerminal({ key: navKey.key })" @touchcancel="onQuickKeyCancel($event)" @click="sendKeyToTerminal({ key: navKey.key })">
          <span class="flick-main" style="font-size:11px">{{ navKey.label }}</span>
        </div>
      </div>
    </template>
    <div v-show="!inputFocused && !showSnippetView && !showFnView" v-for="(row, ri) in qwertyRows" :key="ri" class="quick-extra-row">
      <div
        v-if="ri === 2"
        class="quick-key"
        @touchstart.prevent="onModifierKeyStart"
        @touchend.prevent="(e) => onModifierKeyEnd(e, openCamera)"
        @touchcancel="onQuickKeyCancel($event)"
        @click="openCamera"
      >
        <span class="flick-main"><span class="mdi mdi-camera"></span></span>
      </div>
      <template v-for="(keyDef, ci) in row" :key="ci">
        <div
          class="quick-key"
          :class="{ 'quick-flick-arrow': hasFlick(ri, ci, keyDef) }"
          @touchstart.prevent="onQwertyTouchStart($event, keyDef)"
          @touchend.prevent="onQwertyTouchEnd($event, keyDef, ri, ci)"
          @touchcancel="onQuickKeyCancel($event)"
          @click="keyDef.key === '_camera' ? openCamera() : undefined"
        >
          <template v-if="keyDef.key === '_camera'">
            <span class="flick-main"><span class="mdi mdi-camera"></span></span>
          </template>
          <template v-else-if="hasFlick(ri, ci, keyDef)">
            <span v-if="(!showSymbolView || keyDef.noSymbol) && flickUpLabel(ri, ci, keyDef)" class="flick-hint-top">{{ flickUpLabel(ri, ci, keyDef) }}</span>
            <span :class="['flick-main', { 'flick-main-text': symbolDisplayLabel(keyDef).length > 1 }]">{{ symbolDisplayLabel(keyDef) }}</span>
            <span v-if="(!showSymbolView || keyDef.noSymbol) && keyDef.flickDown" class="flick-hint-bottom">{{ keyDef.flickDown }}</span>
          </template>
          <template v-else>{{ symbolDisplayLabel(keyDef) }}</template>
        </div>
        <div
          v-if="ri === 2 && ci === row.length - 1"
          class="quick-key"
          @touchstart.prevent="onModifierKeyStart"
          @touchend.prevent="(e) => onModifierKeyEnd(e, () => sendKeyToTerminal({ key: 'Enter' }))"
          @touchcancel="onQuickKeyCancel($event)"
          @click="() => sendKeyToTerminal({ key: 'Enter' })"
        >
          <span class="flick-main" style="font-size:13px">&crarr;</span>
        </div>
      </template>
    </div>
    <div v-show="!inputFocused" class="quick-extra-row quick-extra-modifier-keys">
      <div
        class="quick-key quick-flick-arrow quick-modifier"
        :class="{ active: modifierState.shift }"
        @touchstart.prevent="shiftFlick.onStart"
        @touchend.prevent="shiftFlick.onEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="toggleShift"
      >
        <span class="flick-hint-top" :class="{ 'flick-hint-active': showSymbolView }">#+=</span>
        <span class="flick-main"><span class="mdi mdi-arrow-up-bold"></span></span>
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
        :class="{ active: showFnView }"
        @touchstart.prevent="fnFlick.onStart"
        @touchend.prevent="fnFlick.onEnd"
        @touchcancel="onQuickKeyCancel($event)"
        @click="toggleFnView"
      >
        <span class="flick-hint-top">Refresh</span>
        <span class="flick-main" style="font-size:12px">fn</span>
        <span class="flick-hint-bottom">Reload</span>
      </div>
      <div
        class="quick-key quick-modifier"
        :class="{ active: showSnippetView }"
        @touchstart.prevent="onModifierKeyStart"
        @touchend.prevent="(e) => onModifierKeyEnd(e, toggleSnippetView)"
        @touchcancel="onQuickKeyCancel($event)"
        @click="toggleSnippetView"
      >
        <span class="flick-main"><span class="mdi mdi-text-box-multiple-outline"></span></span>
      </div>
    </div>
    <div v-if="!hideBottomRow" class="quick-extra-row quick-extra-bottom-keys">
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
        :class="{ 'enter-send-mode': hasDraft, 'enter-disabled': inputFocused && !hasDraft }"
        ref="topEnterFlickEl"
      >
        <template v-if="hasDraft">
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
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useInputStore } from "../stores/input.js";
import { useAuthStore } from "../stores/auth.js";
import { useInputDraftHistory } from "../composables/useInputDraftHistory.js";
import { emit, on } from "../app-bridge.js";
import { arrowResolver, enterResolver } from "../utils/flick-resolvers.js";
import { createFlickHandlers } from "../utils/flick-handlers.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import KeyboardInput from "./KeyboardInput.vue";
import KeyboardChips from "./KeyboardChips.vue";

const props = defineProps({
  active: { type: Boolean, default: false },
  hideBottomRow: { type: Boolean, default: false },
  externalInputFocused: { type: Boolean, default: false },
  externalSnippetView: { type: Boolean, default: false },
});

const emitLocal = defineEmits(["cycleMode", "submitted", "inputFocus", "snippetToggle"]);

const inputStore = useInputStore();
const auth = useAuthStore();
const { sendKeyToTerminal, sendTextToTerminal, modifierState, clearModifiers, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();

const keyboardInput = ref(null);
const _inputFocused = ref(false);
const draft = ref("");
const hasDraft = computed(() => draft.value.trim().length > 0);
const _showSnippetView = ref(false);

// hideBottomRow=true のとき KeyboardBar が状態を管理する
const inputFocused = computed(() => props.hideBottomRow ? props.externalInputFocused : _inputFocused.value);
const showSnippetView = computed(() => props.hideBottomRow ? props.externalSnippetView : _showSnippetView.value);

function toggleSnippetView() {
  if (props.hideBottomRow) {
    emitLocal("snippetToggle");
  } else {
    _showSnippetView.value = !_showSnippetView.value;
  }
}

const { historyPrev, historyNext, cycleSnippet } = useInputDraftHistory(
  draft, inputFocused, sendTextToTerminal, { onSend: () => emitLocal("cycleMode") }
);

function onInputFocused(focused) {
  _inputFocused.value = !!focused;
  emitLocal("inputFocus", !!focused);
}

function onChipTap({ command }) {
  if (inputFocused.value) {
    draft.value = command;
    keyboardInput.value?.focus?.();
  } else {
    sendTextToTerminal(command);
    inputStore.addInputHistory(command);
    emitLocal("cycleMode");
    return;
  }
  _showSnippetView.value = false;
}

defineExpose({});

watch(() => props.active, (active) => {
  if (!active) {
    clearModifiers();
    showFnView.value = false;
    showSymbolView.value = false;
  }
});
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
  return !!keyDef.flickUp || !!keyDef.flickDown;
}

function flickUpLabel(ri, ci, keyDef) {
  return keyDef.flickUpLabel || keyDef.flickUp || "";
}

function onQuickKeyCancel(e) {
  e.currentTarget.classList.remove("pressed");
}

function onModifierKeyStart(e) {
  e.currentTarget.classList.add("pressed");
}

function onModifierKeyEnd(e, fn) {
  const el = e.currentTarget;
  el.classList.remove("pressed");
  el.classList.remove("tap-bounce");
  void el.offsetWidth;
  el.classList.add("tap-bounce");
  fn();
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
    const upKey = { key: keyDef.flickUp, label: keyDef.flickUp };
    if (upKey.key) sendOrType(upKey);
    return;
  }
  if (keyDef.flickDown && dy > 30) {
    sendOrType({ key: keyDef.flickDown, label: keyDef.flickDown });
    return;
  }
  if (showSymbolView.value && keyDef.flickUp && !keyDef.noSymbol && Math.abs(dy) <= 30) {
    sendOrType({ key: keyDef.flickUp, label: keyDef.flickUp });
    return;
  }
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendOrType(merged);
}


function doRefresh() {
  const tab = getActiveTerminalTab();
  if (tab) emit("tab:refresh", { tab });
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

function toggleShift() {
  if (showSymbolView.value) {
    showSymbolView.value = false;
    modifierState.shift = false;
    return;
  }
  modifierState.shift = !modifierState.shift;
  if (modifierState.shift) { showFnView.value = false; }
}
function toggleCtrl() {
  modifierState.ctrl = !modifierState.ctrl;
  if (modifierState.ctrl) showFnView.value = false;
}
function sendSpace() { sendKeyToTerminal({ key: " " }); }
const showFnView = ref(false);
const fnFlick = createFlickHandlers({ up: doRefresh, down: doReload, tap: toggleFnView });
function toggleFnView() {
  showFnView.value = !showFnView.value;
  if (showFnView.value) {
    modifierState.shift = false;
    modifierState.ctrl = false;
    showSymbolView.value = false;
    if (props.hideBottomRow) {
      if (props.externalSnippetView) emitLocal("snippetToggle");
    } else {
      _showSnippetView.value = false;
    }
  }
}
const navKeys = [
  { label: "Home",  key: "Home" },
  { label: "End",   key: "End" },
  { label: "PgUp",  key: "PageUp" },
  { label: "PgDn",  key: "PageDown" },
  { label: "Ins",   key: "Insert" },
  { label: "F11",   key: "F11" },
  { label: "F12",   key: "F12" },
];

function onFnNumberTouchStart(e) {
  e.currentTarget.classList.add("pressed");
  e.currentTarget._touchStartY = e.touches[0].clientY;
}

function onFnNumberTouchEnd(e, keyDef) {
  e.currentTarget.classList.remove("pressed");
  const dy = e.changedTouches[0].clientY - (e.currentTarget._touchStartY || 0);
  if (keyDef.flickUp && dy < -30) {
    sendKeyToTerminal({ key: keyDef.flickUp });
    return;
  }
  sendKeyToTerminal({ key: keyDef.key });
}

const showSymbolView = ref(false);
function toggleSymbolView() {
  showSymbolView.value = !showSymbolView.value;
  if (showSymbolView.value) { modifierState.shift = false; showFnView.value = false; }
}

function symbolDisplayLabel(keyDef) {
  if (showSymbolView.value && keyDef.flickUp && !keyDef.noSymbol) return keyDef.flickUp;
  return displayLabel(keyDef);
}

const shiftFlick = createFlickHandlers({
  up: () => {
    const next = !showSymbolView.value;
    showSymbolView.value = next;
    modifierState.shift = false;
    if (next) showFnView.value = false;
  },
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
    topArrowFlickEl.value.addEventListener("touchstart", () => { arrowFlickHandled = false; }, { passive: true });
    const onArrowFlick = (key) => {
      if (!inputFocused.value) return false;
      if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
        if (!arrowFlickHandled) { arrowFlickHandled = true; cycleSnippet(key.key === "ArrowLeft" ? 1 : -1); }
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
      if (hasDraft.value) {
        keyboardInput.value?.submit?.();
        return;
      }
      if (inputFocused.value) return;
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
