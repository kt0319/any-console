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
          @click="onQwertyTap(keyDef)"
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
          @touchend.prevent="(e) => onModifierKeyEnd(e, () => sendOrType({ key: 'Enter', shift: modifierState.shift, ctrl: modifierState.ctrl }))"
          @touchcancel="onQuickKeyCancel($event)"
          @click="() => sendOrType({ key: 'Enter', shift: modifierState.shift, ctrl: modifierState.ctrl })"
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
import { useQwertyKeyViews } from "../composables/useQwertyKeyViews.js";
import { useQwertyKeyPress } from "../composables/useQwertyKeyPress.js";
import { useQwertyCamera } from "../composables/useQwertyCamera.js";
import { useQwertyBottomRowFlicks } from "../composables/useQwertyBottomRowFlicks.js";
import { on } from "../app-bridge.js";
import { qwertyHasFlick, qwertyFlickUpLabel, qwertySymbolLabel } from "../utils/qwerty-key.js";
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

function dismissSnippetView() {
  if (!showSnippetView.value) return;
  if (props.hideBottomRow) emitLocal("snippetToggle");
  else _showSnippetView.value = false;
}

// fn ビュー表示時に snippet ビューを閉じる (hideBottomRow 時は KeyboardBar 側の状態を切替)
function closeSnippetView() {
  if (props.hideBottomRow) {
    if (props.externalSnippetView) emitLocal("snippetToggle");
  } else {
    _showSnippetView.value = false;
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

const topArrowFlickEl = ref(null);
const topEnterFlickEl = ref(null);

const qwertyRows = computed(() => inputStore.QWERTY_ROWS || []);
const numberKeys = computed(() => inputStore.NUMBER_KEYS || []);

function doReload() {
  emitLocal("cycleMode");
  window.location.replace(window.location.pathname + "?_=" + Date.now());
}

const {
  showFnView, showSymbolView,
  toggleShift, toggleCtrl, toggleFnView, sendSpace,
  shiftFlick, ctrlFlick, spaceFlick, fnFlick,
} = useQwertyKeyViews({
  modifierState, showSnippetView, dismissSnippetView, closeSnippetView,
  sendKeyToTerminal, getActiveTerminalTab, onReload: doReload,
});

const { cameraInputEl, openCamera, onCameraFileChange } = useQwertyCamera({
  apiFetch: auth.apiFetch.bind(auth),
  getActiveTerminalTab,
  onBeforeUpload: () => emitLocal("cycleMode"),
});

const {
  sendOrType,
  onQwertyTouchStart, onQwertyTouchEnd, onQwertyTap,
  onFnNumberTouchStart, onFnNumberTouchEnd,
} = useQwertyKeyPress({
  keyboardInput, hasDraft, modifierState, showSymbolView, sendKeyToTerminal, openCamera,
});

watch(() => props.active, (active) => {
  if (!active) {
    clearModifiers();
    showFnView.value = false;
    showSymbolView.value = false;
  }
});

function hasFlick(ri, ci, keyDef) {
  return qwertyHasFlick(keyDef);
}

function flickUpLabel(ri, ci, keyDef) {
  return qwertyFlickUpLabel(keyDef);
}

function symbolDisplayLabel(keyDef) {
  return qwertySymbolLabel(keyDef, modifierState.shift, showSymbolView.value);
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

const navKeys = [
  { label: "Home",  key: "Home" },
  { label: "End",   key: "End" },
  { label: "PgUp",  key: "PageUp" },
  { label: "PgDn",  key: "PageDown" },
  { label: "Ins",   key: "Insert" },
  { label: "F11",   key: "F11" },
  { label: "F12",   key: "F12" },
];

useQwertyBottomRowFlicks({
  arrowEl: topArrowFlickEl,
  enterEl: topEnterFlickEl,
  inputFocused, hasDraft, keyboardInput,
  cycleSnippet, historyPrev, historyNext,
  setupFlickRepeat, sendKeyToTerminal,
  dismissKeyboard: () => emitLocal("cycleMode"),
});

let offSnippetTap = null;
onMounted(() => {
  offSnippetTap = on("snippet:tap", () => {
    if (props.active) emitLocal("cycleMode");
  });
});
onUnmounted(() => { offSnippetTap?.(); });

</script>
