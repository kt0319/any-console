<template>
  <div v-show="isVisible" class="keyboard-bar">
    <KeyboardQwertyKey
      ref="qwertyView"
      :active="isFullKeyboard"
      :hide-bottom-row="true"
      :external-input-focused="inputFocused"
      :external-snippet-view="showSnippetView"
      @dismiss="hideInput"
      @submitted="onSubmitted"
      @snippetToggle="toggleSnippetView"
    />
    <!-- バー行 = フルキーボードの最下行と同構成 -->
    <div class="keyboard-bar-row">
      <KeyboardInput
        ref="keyboardInput"
        v-model:draft="draft"
        @focused="onInputFocused"
        @submitted="onSubmitted"
      />
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
import { ref, computed } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useLayoutStore } from "../stores/layout.js";
import { useInputDraftHistory } from "../composables/useInputDraftHistory.js";
import { useKeyboardBarFlicks } from "../composables/useKeyboardBarFlicks.js";
import { useKeyboardBarState } from "../composables/useKeyboardBarState.js";
import { emit } from "../app-bridge.js";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";
import KeyboardChips from "./KeyboardChips.vue";

const props = defineProps({
  isPanelBottom: { type: Boolean, default: false },
});

const layoutStore = useLayoutStore();
const isVisible = computed(() => props.isPanelBottom || layoutStore.isSplitMode);

const { clearModifiers, sendKeyToTerminal, sendTextToTerminal, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();

const qwertyView = ref(null);
const keyboardInput = ref(null);
const barArrowFlickEl = ref(null);
const barEnterFlickEl = ref(null);

// ─── 入力 / スニペット状態・キーボード開閉 ──────────────────────
const {
  isFullKeyboard, draft, inputFocused, showSnippetView, hasDraft,
  onInputFocused, toggleSnippetView,
  hideInput, dismissKeyboard, onSubmitted,
} = useKeyboardBarState({ keyboardInput, clearModifiers, sendTextToTerminal });

const { historyPrev, historyNext, cycleSnippet } = useInputDraftHistory(draft, inputFocused, sendTextToTerminal);

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

useKeyboardBarFlicks({
  arrowEl: barArrowFlickEl, enterEl: barEnterFlickEl,
  inputFocused, hasDraft, draft, keyboardInput,
  cycleSnippet, historyPrev, historyNext,
  setupFlickRepeat, sendKeyToTerminal, dismissKeyboard,
});
</script>

<style>
@import "../styles/keyboard-bar.css";
</style>
