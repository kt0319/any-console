<template>
  <div v-show="isVisible" class="keyboard-bar">
    <KeyboardQwertyKey
      ref="qwertyView"
      :active="isFullKeyboard"
      :hide-bottom-row="true"
      :external-input-focused="inputFocused"
      :external-fn-view="showFnView"
      @dismiss="hideInput"
      @submitted="onSubmitted"
      @fnToggle="toggleFnView"
    />
    <!-- コンパクト入力中のスニペット / 履歴挿入オーバーレイ（フルキーボード側の挿入ビューと同じ onChipTap を再利用） -->
    <div v-if="showSnippetView && !isFullKeyboard" class="keyboard-bar-snippet-overlay">
      <KeyboardChips :mode="snippetPanelView" @chip:tap="onChipTap" />
    </div>
    <!-- バー行 = フルキーボードの最下行と同構成 -->
    <div class="keyboard-bar-row">
      <KeyboardInput
        v-show="!isFullKeyboard"
        ref="keyboardInput"
        v-model:draft="draft"
        :snippet-view="snippetPanelView"
        @focused="onInputFocused"
        @submitted="onSubmitted"
        @snippetToggle="toggleSnippetView"
      />
      <!-- ソフト（QWERTY）キーボード表示中は入力フォームの代わりに shift/ctrl/space を表示 -->
      <div v-if="isFullKeyboard" class="keyboard-bar-modifier-keys">
        <div
          class="quick-key quick-flick-arrow quick-modifier"
          :class="{ active: modifierState.shift }"
          @touchstart.prevent="shiftFlick.onStart"
          @touchend.prevent="shiftFlick.onEnd"
          @touchcancel="onQuickKeyCancel($event)"
          @click="toggleShift"
        >
          <span class="flick-hint-top">Refresh</span>
          <span class="flick-main"><span class="mdi mdi-arrow-up-bold"></span></span>
          <span class="flick-hint-bottom">Reload</span>
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
      </div>
      <div class="quick-key quick-flick-arrow quick-key-toggle" :class="{ active: isFullKeyboard || inputFocused }" ref="barArrowFlickEl">
        <span class="flick-hint-top">&uarr;</span>
        <span class="flick-hint-left">&larr;</span>
        <span class="flick-main"><span :class="['mdi', (isFullKeyboard || inputFocused) ? 'mdi-close' : 'mdi-keyboard']"></span></span>
        <span class="flick-hint-right">&rarr;</span>
        <span class="flick-hint-bottom">&darr;</span>
      </div>
      <div
        class="quick-key quick-flick-enter quick-flick-arrow quick-key-toggle"
        :class="{ 'enter-send-mode': hasDraft, 'enter-disabled': inputFocused && !hasDraft }"
        ref="barEnterFlickEl"
      >
        <template v-if="hasDraft">
          <span class="flick-hint-left" style="font-size:8px">clear</span>
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
import { ref, computed, watch } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useLayoutStore } from "../stores/layout.js";
import { useInputDraftHistory } from "../composables/useInputDraftHistory.js";
import { useKeyboardBarFlicks } from "../composables/useKeyboardBarFlicks.js";
import { useKeyboardBarState } from "../composables/useKeyboardBarState.js";
import { useQwertyKeyViews } from "../composables/useQwertyKeyViews.js";
import { useSnippetPersist } from "../composables/useSnippetPersist.js";
import { emit } from "../app-bridge.js";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";
import KeyboardChips from "./KeyboardChips.vue";

const props = defineProps({
  isPanelBottom: { type: Boolean, default: false },
});

const layoutStore = useLayoutStore();
const isVisible = computed(() => props.isPanelBottom || layoutStore.isSplitMode);

const { clearModifiers, sendKeyToTerminal, modifierState, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();
const { moveSnippetToFront } = useSnippetPersist();

const qwertyView = ref(null);
const keyboardInput = ref(null);
const barArrowFlickEl = ref(null);
const barEnterFlickEl = ref(null);

// ─── 入力 / スニペット状態・キーボード開閉 ──────────────────────
const {
  isFullKeyboard, draft, inputFocused, showSnippetView, snippetPanelView, hasDraft,
  onInputFocused, toggleSnippetView, closeSnippetPanel, onChipTap,
  hideInput, dismissKeyboard, onSubmitted,
} = useKeyboardBarState({ keyboardInput, clearModifiers, moveSnippetToFront });

const { historyPrev, historyNext } = useInputDraftHistory(draft);

function doRefresh() {
  const tab = getActiveTerminalTab();
  if (tab) emit("tab:refresh", { tab });
}
function doReload() {
  window.location.replace(window.location.pathname + "?_=" + Date.now());
}

function onQuickKeyCancel(e) {
  e.currentTarget.classList.remove("pressed");
}

// isFullKeyboard 中、入力フォームの代わりに表示する shift/ctrl/space（bar行）。
// fn は QWERTY パネルの Esc キー位置、snippet は Enter キー位置に統合されているため、
// ここでは showFnView/toggleFnView のみ KeyboardQwertyKey.vue へ受け渡す用に保持する
// （showFnView は external-fn-view prop 経由、modifierState はモジュール単位のシングルトン）。
const {
  showFnView,
  toggleShift, toggleCtrl, toggleFnView, sendSpace,
  shiftFlick, ctrlFlick, spaceFlick,
} = useQwertyKeyViews({
  modifierState,
  showSnippetView,
  dismissSnippetView: closeSnippetPanel,
  closeSnippetView: closeSnippetPanel,
  sendKeyToTerminal,
  getActiveTerminalTab,
  onReload: doReload,
});

// フル（QWERTY）キーボードを閉じたら fn ビュー（数字/記号パッド）も閉じる
watch(isFullKeyboard, (active) => {
  if (!active) showFnView.value = false;
});

useKeyboardBarFlicks({
  arrowEl: barArrowFlickEl, enterEl: barEnterFlickEl,
  inputFocused, hasDraft, draft, keyboardInput,
  historyPrev, historyNext,
  setupFlickRepeat, sendKeyToTerminal, dismissKeyboard,
});
</script>

<style>
@import "../styles/keyboard-bar.css";
</style>
