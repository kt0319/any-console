<template>
  <div v-show="isVisible" class="keyboard-bar">
    <!-- モード切替タブ行。隅の鍵盤トグルキー（タップ=開閉＋スワイプで矢印/履歴）とは別の入口で、QWERTYパネルを開いている間だけ表示する -->
    <div v-if="isFullKeyboard" class="keyboard-bar-tabs">
      <button
        v-for="t in KEYBOARD_BAR_TABS"
        :key="t.id"
        type="button"
        class="quick-key keyboard-bar-tab"
        :class="{ active: isTabActive(t.id) }"
        :aria-label="t.label"
        :data-tooltip="t.label"
        @click="onTabClick(t.id)"
      >
        <span class="mdi" :class="t.icon"></span>
        <span class="keyboard-bar-tab-label">{{ t.label }}</span>
      </button>
      <button
        type="button"
        class="quick-key keyboard-bar-tab keyboard-bar-tab-close"
        aria-label="Close keyboard"
        data-tooltip="Close keyboard"
        @click="hideInput"
      >
        <span class="mdi mdi-close"></span>
      </button>
    </div>
    <!-- History/Snippet表示中は、下のSendSnippet/SendHistoryオーバーレイがこの領域の高さ全体を覆って一覧表示に使う -->
    <div class="keyboard-bar-content">
      <KeyboardQwertyKey
        :active="isFullKeyboard"
        :external-input-focused="inputFocused"
        :external-fn-view="showFnView"
        :panel-view="snippetPanelView"
        @dismiss="hideInput"
      />
      <!-- History/Snippet表示中も行は残す。v-ifで着脱するとフリック用DOMが差し替わり、onMountedで張ったリスナが失効するため visibility:hidden で隠す -->
      <div class="keyboard-bar-row" :class="{ 'keyboard-bar-row-hidden': showSnippetView }">
        <KeyboardInput
          v-show="!isFullKeyboard"
          ref="keyboardInput"
          v-model:draft="draft"
          :history-prev="historyPrev"
          :history-next="historyNext"
          @focused="onInputFocused"
          @submitted="onSubmitted"
        />
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
          <span class="flick-hint-top">&uarr;<span v-if="inputFocused" class="mdi mdi-history"></span></span>
          <span class="flick-hint-left">&larr;<span v-if="inputFocused" class="mdi mdi-bookmark-multiple"></span></span>
          <span class="flick-main"><span :class="['mdi', (isFullKeyboard || inputFocused) ? 'mdi-close' : 'mdi-keyboard']"></span></span>
          <span class="flick-hint-right">&rarr;<span v-if="inputFocused" class="mdi mdi-bookmark-multiple"></span></span>
          <span class="flick-hint-bottom">&darr;<span v-if="inputFocused" class="mdi mdi-history"></span></span>
        </div>
        <div
          class="quick-key quick-flick-enter quick-flick-arrow quick-key-toggle"
          :class="{ 'enter-send-mode': hasDraft, 'enter-disabled': inputFocused && !hasDraft }"
          ref="barEnterFlickEl"
        >
          <template v-if="hasDraft">
            <span class="flick-hint-left" style="font-size:8px">clear</span>
            <span class="flick-hint-bottom">&crarr;</span>
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
      <SendSnippet
        v-if="snippetPanelView === 'snippets'"
        embedded
        class="keyboard-bar-panel-overlay"
        @close="hideInput"
      />
      <SendHistory
        v-if="snippetPanelView === 'history'"
        embedded
        class="keyboard-bar-panel-overlay"
        @close="hideInput"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useKeyboard } from "../composables/useKeyboard.ts";
import { useInputDraftHistory } from "../composables/useInputDraftHistory.ts";
import { useSnippetCycle } from "../composables/useSnippetCycle.ts";
import { useKeyboardBarFlicks } from "../composables/useKeyboardBarFlicks.ts";
import { useKeyboardBarState } from "../composables/useKeyboardBarState.ts";
import { useQwertyKeyViews } from "../composables/useQwertyKeyViews.ts";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";
import SendSnippet from "./SendSnippet.vue";
import SendHistory from "./SendHistory.vue";

const props = defineProps({
  visible: { type: Boolean, default: false },
});

// 表示要否は layout store（Settings > Display）で決まり、分割モードとは独立。
const isVisible = computed(() => props.visible);

const { clearModifiers, sendKeyToTerminal, modifierState, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();

const keyboardInput = ref<InstanceType<typeof KeyboardInput> | null>(null);
const barArrowFlickEl = ref<HTMLElement | null>(null);
const barEnterFlickEl = ref<HTMLElement | null>(null);

const {
  isFullKeyboard, draft, inputFocused, showSnippetView, snippetPanelView, hasDraft,
  onInputFocused, openSnippetPanel, openHistoryPanel, closeSnippetPanel,
  hideInput, dismissKeyboard, onSubmitted,
} = useKeyboardBarState({ keyboardInput, clearModifiers });

// フリック矢印キーと KeyboardInput.vue の物理矢印キーで historyIndex を共有するため、単一インスタンスを使う。
const { historyPrev, historyNext } = useInputDraftHistory(draft);
const { snippetPrev, snippetNext } = useSnippetCycle(draft);

function doReload() {
  window.location.replace(window.location.pathname + "?_=" + Date.now());
}

function onQuickKeyCancel(e: Event) {
  (e.currentTarget as HTMLElement).classList.remove("pressed");
}

// showFnView は上段タブ（Fn）と KeyboardQwertyKey.vue の external-fn-view prop で共有する。
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

// フルキーボードを閉じたら fn ビュー・History/Snippet も閉じ、再度開いた時は QWERTY グリッドから始める。
watch(isFullKeyboard, (active) => {
  if (!active) {
    showFnView.value = false;
    closeSnippetPanel();
  }
});

// QWERTYタブ: キーボードは開いている前提。Fn/History/Snippetを閉じてQWERTYグリッドに戻すだけ（閉じるのは×ボタンに一本化）。
function onQwertyTabClick() {
  showFnView.value = false;
  closeSnippetPanel();
}

// Fnタブ: fnビューはフルキーボード内でのみ意味を持つため、未展開なら先に展開する。選択式なのでFn表示中の再タップでは閉じない。
function onFnTabClick() {
  if (!isFullKeyboard.value) {
    isFullKeyboard.value = true;
    closeSnippetPanel();
    clearModifiers();
  }
  if (!showFnView.value) toggleFnView();
}

// モード切替タブの定義（並び＝表示順）。active判定・遷移は下の2関数で揃える。
type KeyboardBarTabId = "qwerty" | "fn" | "history" | "snippets";

const KEYBOARD_BAR_TABS: { id: KeyboardBarTabId, label: string, icon: string }[] = [
  { id: "qwerty", label: "QWERTY", icon: "mdi-keyboard-outline" },
  { id: "fn", label: "Fn", icon: "mdi-function-variant" },
  { id: "history", label: "History", icon: "mdi-history" },
  { id: "snippets", label: "Snippet", icon: "mdi-bookmark-multiple" },
];

function isTabActive(id: KeyboardBarTabId) {
  if (id === "qwerty") return isFullKeyboard.value && !showFnView.value && snippetPanelView.value === "none";
  if (id === "fn") return showFnView.value;
  if (id === "history") return snippetPanelView.value === "history";
  return snippetPanelView.value === "snippets";
}

function onTabClick(id: KeyboardBarTabId) {
  if (id === "qwerty") onQwertyTabClick();
  else if (id === "fn") onFnTabClick();
  else if (id === "history") openHistoryPanel();
  else openSnippetPanel();
}

useKeyboardBarFlicks({
  arrowEl: barArrowFlickEl, enterEl: barEnterFlickEl,
  inputFocused, hasDraft, draft, keyboardInput,
  historyPrev, historyNext,
  snippetPrev, snippetNext,
  setupFlickRepeat, sendKeyToTerminal, dismissKeyboard,
});
</script>

<style>
@import "../styles/keyboard-bar.css";
</style>
