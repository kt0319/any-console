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
              :class="{ 'quick-flick-arrow': qwertyHasFlick(keyDef) }"
              @touchstart.prevent="onQwertyTouchStart($event)"
              @touchend.prevent="onQwertyTouchEnd($event, keyDef)"
              @touchcancel="onQuickKeyCancel($event)"
              @click="onQwertyTap(keyDef)"
            >
              <template v-if="keyDef.key === '_camera'">
                <span class="flick-main"><span class="mdi mdi-camera"></span></span>
              </template>
              <template v-else-if="qwertyHasFlick(keyDef)">
                <span v-if="qwertyFlickUpLabel(keyDef)" class="flick-hint-top">{{ qwertyFlickUpLabel(keyDef) }}</span>
                <span :class="['flick-main', { 'flick-main-text': displayLabel(keyDef).length > 1 }]">{{ displayLabel(keyDef) }}</span>
                <span v-if="keyDef.flickDown" class="flick-hint-bottom">{{ keyDef.flickDown }}</span>
              </template>
              <template v-else>{{ displayLabel(keyDef) }}</template>
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

<script setup lang="ts">
import { computed, watch } from "vue";
import { useKeyboard } from "../composables/useKeyboard.ts";
import { useInputStore } from "../stores/input.ts";
import { useAuthStore } from "../stores/auth.ts";
import { useQwertyKeyPress } from "../composables/useQwertyKeyPress.ts";
import { useQwertyCamera } from "../composables/useQwertyCamera.ts";
import { qwertyHasFlick, qwertyFlickUpLabel, qwertyDisplayLabel } from "../utils/qwerty-key.ts";
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

// キーレイアウト（data/keyboard-layout.ts）の1キー分。flickUp/flickDown は
// 一部のキーのみ持つ。
interface QwertyKeyDef {
  label: string;
  key: string;
  flickUp?: string;
  flickDown?: string;
}

const inputFocused = computed(() => props.externalInputFocused);
const panelView = computed(() => props.panelView);

const qwertyRows = computed<QwertyKeyDef[][]>(() => inputStore.QWERTY_ROWS || []);
const numberKeys = computed<QwertyKeyDef[]>(() => inputStore.NUMBER_KEYS || []);

const showFnView = computed(() => props.externalFnView);

const { cameraInputEl, openCamera, onCameraFileChange } = useQwertyCamera({
  apiFetch: auth.apiFetch.bind(auth),
  getActiveTerminalTab,
  onBeforeUpload: () => emitLocal("dismiss"),
});

const {
  onQwertyTouchStart, onQwertyTouchEnd, onQwertyTap,
  onFnNumberTouchStart, onFnNumberTouchEnd,
} = useQwertyKeyPress({
  modifierState, sendKeyToTerminal, openCamera,
});

watch(() => props.active, (active) => {
  if (!active) clearModifiers();
});

function displayLabel(keyDef: QwertyKeyDef) {
  return qwertyDisplayLabel(keyDef, modifierState.shift);
}

function onQuickKeyCancel(e: Event) {
  (e.currentTarget as HTMLElement).classList.remove("pressed");
}

function onModifierKeyStart(e: Event) {
  (e.currentTarget as HTMLElement).classList.add("pressed");
}

function onModifierKeyEnd(e: Event, fn: () => void) {
  const el = e.currentTarget as HTMLElement;
  el.classList.remove("pressed");
  restartTapBounce(el);
  fn();
}

function onNavKeyEnd(e: Event, key: string) {
  restartTapBounce(e.currentTarget as HTMLElement);
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
