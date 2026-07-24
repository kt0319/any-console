<template>
  <div v-show="active" class="quick-extra-panel quick-qwerty-panel">
    <input
      ref="cameraInputEl"
      type="file"
      accept="image/*"
      style="display:none"
      @change="onCameraFileChange"
    />
    <div class="quick-extra-stack">
      <div class="quick-extra-layer quick-extra-layer-qwerty" :class="{ 'layer-hidden': inputFocused || showSnippetView || showFnView }">
        <div v-for="(row, ri) in qwertyRows" :key="ri" class="quick-extra-row">
          <div
            v-if="ri === 2"
            class="quick-key"
            @touchstart.prevent="onModifierKeyStart"
            @touchend.prevent="(e) => onModifierKeyEnd(e, () => sendKeyToTerminal({ key: 'Escape' }))"
            @touchcancel="onQuickKeyCancel($event)"
            @click="sendKeyToTerminal({ key: 'Escape' })"
          >
            <span class="flick-main">Esc</span>
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
            <!-- fn キーの旧スロット。列幅を他行と揃えるための非表示プレースホルダ
                 （実体は quick-extra-stack 直下に絶対配置で常時右下固定表示） -->
            <div v-if="ri === 2 && ci === row.length - 1" class="quick-key quick-key-placeholder"></div>
          </template>
        </div>
      </div>

      <div v-if="showSnippetView && !inputFocused" class="quick-extra-layer quick-extra-layer-overlay">
        <div class="keyboard-chips-row">
          <KeyboardChips :insert-mode="true" @chip:tap="onChipTap" />
        </div>
      </div>

      <div v-if="showFnView && !inputFocused" class="quick-extra-layer quick-extra-layer-overlay">
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
          <div v-for="navKey in navKeys" :key="navKey.key" class="quick-key quick-fn-key" @touchstart.prevent @touchend.prevent="(e) => onNavKeyEnd(e, navKey.key)" @touchcancel="onQuickKeyCancel($event)" @click="sendKeyToTerminal({ key: navKey.key })">
            <span class="flick-main" style="font-size:11px">{{ navKey.label }}</span>
          </div>
        </div>
      </div>

      <!-- fn キー: qwerty / snippet / fn のどのパネル表示中も同じ右下位置に固定表示する -->
      <div
        class="quick-key quick-modifier quick-fn-toggle"
        :class="{ active: showFnView }"
        @touchstart.prevent="onModifierKeyStart"
        @touchend.prevent="(e) => onModifierKeyEnd(e, cycleFnKey)"
        @touchcancel="onQuickKeyCancel($event)"
        @click="cycleFnKey"
      >
        <span class="flick-main" style="font-size:12px">{{ fnKeyLabel }}</span>
      </div>
    </div>
    <!-- shift/ctrl/space は KeyboardBar 側（isFullKeyboard 中に入力フォームと入れ替わる行）に移動済み。
         fn は Esc キー位置、snippet は Enter キー位置に統合済み（上の quick-extra-layer-qwerty 内）。 -->
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
  externalFnView: { type: Boolean, default: false },
});

const emitLocal = defineEmits(["dismiss", "submitted", "snippetToggle", "fnToggle"]);

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

function toggleFnView() {
  if (props.hideBottomRow) {
    emitLocal("fnToggle");
  } else {
    _showFnView.value = !_showFnView.value;
  }
}

// fn キー: タップごとに fnビュー → snippetビュー → 通常グリッド → fnビュー…と巡回する。
// toggleFnView が ON 化時に closeSnippetView（snippet を閉じる）を伴うため、
// fn→snippet の遷移は「fn を先に OFF」→「snippet を ON」の順で呼ぶ。
function cycleFnKey() {
  if (showFnView.value) {
    toggleFnView();
    toggleSnippetView();
  } else if (showSnippetView.value) {
    toggleSnippetView();
  } else {
    toggleFnView();
  }
}

// fn キーのラベル。予告型 = 次にタップしたら遷移する先の状態を表示する
// （qwerty中は次がfnなので "fn"、fn中は次がsnippetなので "snip"、snippet中は次がqwertyなので "ABC"）。
const fnKeyLabel = computed(() => {
  if (showFnView.value) return "snip";
  if (showSnippetView.value) return "ABC";
  return "fn";
});

const { historyPrev, historyNext, cycleSnippet } = useInputDraftHistory(
  draft, inputFocused, sendTextToTerminal, { onSend: () => emitLocal("dismiss") }
);

function onInputFocused(focused) {
  _inputFocused.value = !!focused;
}

function onChipTap({ command }) {
  if (inputFocused.value) {
    draft.value = command;
    keyboardInput.value?.focus?.();
  } else {
    sendTextToTerminal(command);
    inputStore.addInputHistory(command);
    emitLocal("dismiss");
    return;
  }
  _showSnippetView.value = false;
}

defineExpose({});

const topArrowFlickEl = ref(null);
const topEnterFlickEl = ref(null);

const qwertyRows = computed(() => inputStore.QWERTY_ROWS || []);
const numberKeys = computed(() => inputStore.NUMBER_KEYS || []);

// fn ビュー（数字/記号パッド）の開閉状態は shift/ctrl/space と同じく KeyboardBar 側が単一管理する
// （hideBottomRow=true のとき external-fn-view prop 経由で渡される）。
const _showFnView = ref(false);
const showFnView = computed(() => props.hideBottomRow ? props.externalFnView : _showFnView.value);
// 記号ロック機能は撤去済み。symbolDisplayLabel 等の分岐を壊さないための常時 false の無害な状態。
const showSymbolView = ref(false);

const { cameraInputEl, openCamera, onCameraFileChange } = useQwertyCamera({
  apiFetch: auth.apiFetch.bind(auth),
  getActiveTerminalTab,
  onBeforeUpload: () => emitLocal("dismiss"),
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
    _showFnView.value = false;
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

function onNavKeyEnd(e, key) {
  const el = e.currentTarget;
  el.classList.remove("tap-bounce");
  void el.offsetWidth;
  el.classList.add("tap-bounce");
  sendKeyToTerminal({ key });
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
  dismissKeyboard: () => emitLocal("dismiss"),
});

let offSnippetTap = null;
onMounted(() => {
  offSnippetTap = on("snippet:tap", () => {
    if (props.active) emitLocal("dismiss");
  });
});
onUnmounted(() => { offSnippetTap?.(); });

</script>
