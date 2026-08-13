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
      <div class="quick-extra-layer quick-extra-layer-qwerty" :class="{ 'layer-hidden': inputFocused || showFnView || panelView !== 'none' }">
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
          </template>
          <!-- カメラキーの右にBSキーを追加する
               （a行末尾の Backspace/flickUp:Delete キーとは別の入り口として並存）。 -->
          <div
            v-if="ri === 2"
            class="quick-key"
            @touchstart.prevent="onModifierKeyStart"
            @touchend.prevent="(e) => onModifierKeyEnd(e, () => sendKeyToTerminal({ key: 'Backspace' }))"
            @touchcancel="onQuickKeyCancel($event)"
            @click="sendKeyToTerminal({ key: 'Backspace' })"
          >
            <span class="flick-main" style="font-size:11px">BS</span>
          </div>
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useInputStore } from "../stores/input.js";
import { useAuthStore } from "../stores/auth.js";
import { useQwertyKeyPress } from "../composables/useQwertyKeyPress.js";
import { useQwertyCamera } from "../composables/useQwertyCamera.js";
import { qwertyHasFlick, qwertyFlickUpLabel, qwertySymbolLabel } from "../utils/qwerty-key.ts";
import { restartTapBounce } from "../utils/dom.ts";

// KeyboardBar.vue専用の部品（単独では使わない）。入力欄・矢印/Enterキーなどの
// 状態はすべてKeyboardBar.vue側で一元管理し、このコンポーネントへはprops経由で
// 渡す（inputFocused/showFnView/panelView）。
const props = defineProps({
  active: { type: Boolean, default: false },
  externalInputFocused: { type: Boolean, default: false },
  externalFnView: { type: Boolean, default: false },
  // "none" | "snippets" | "history"。History/Snippet表示中はQWERTYグリッド層を
  // 隠す（実際のSendSnippet/SendHistoryはKeyboardBar.vue側が、このコンポーネント
  // とbar行の両方を覆うオーバーレイとして描画する。理由はKeyboardBar.vueの
  // コメント参照）。
  panelView: { type: String, default: "none" },
});

const emitLocal = defineEmits(["dismiss"]);

const inputStore = useInputStore();
const auth = useAuthStore();
const { sendKeyToTerminal, modifierState, clearModifiers, getActiveTerminalTab } = useKeyboard();

const keyboardInput = ref(null);
const draft = ref("");
const hasDraft = computed(() => draft.value.trim().length > 0);

const inputFocused = computed(() => props.externalInputFocused);
const panelView = computed(() => props.panelView);

const qwertyRows = computed(() => inputStore.QWERTY_ROWS || []);
const numberKeys = computed(() => inputStore.NUMBER_KEYS || []);

const showFnView = computed(() => props.externalFnView);
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
  restartTapBounce(el);
  fn();
}

function onNavKeyEnd(e, key) {
  restartTapBounce(e.currentTarget);
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
</script>
