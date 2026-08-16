<template>
  <div v-show="isVisible" class="keyboard-bar">
    <!-- モード切替タブ行。QWERTY/Fn/History/Snippetを直接選択できる常設タブ
         （従来の隅の鍵盤トグルキーとは別の入り口として追加。隅の鍵盤トグルキーは
         タップ=開閉に加えスワイプで矢印キー送信/履歴移動を兼ねる複合キーのため、
         そちらの操作性は変えずそのまま残す）。
         ソフトキーボード（QWERTYパネル）を開いている間だけ表示する。 -->
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
    <!-- QWERTYパネル+bar行をまとめた入れ物。History/Snippet表示中は、下の
         SendSnippet/SendHistoryオーバーレイがこの2つ分の高さをまるごと覆い、
         一覧をそのスペースいっぱいに表示する（bar行だけ空けて隠すのではなく、
         一覧の表示領域として使う）。 -->
    <div class="keyboard-bar-content">
      <KeyboardQwertyKey
        :active="isFullKeyboard"
        :external-input-focused="inputFocused"
        :external-fn-view="showFnView"
        :panel-view="snippetPanelView"
        @dismiss="hideInput"
      />
      <!-- バー行 = フルキーボードの最下行と同構成。
           History/Snippetタブ表示中はキー部分を隠すが、行自体（DOM・高さ）は
           残す（v-ifで着脱するとbarArrowFlickEl/barEnterFlickElのDOM要素が
           差し替わり、useKeyboardBarFlicksがonMounted一回きりで張っている
           イベントリスナが失効してしまうため、visibility:hiddenで見た目だけ
           消し高さは一定に保つ）。 -->
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
import { useKeyboardBarFlicks } from "../composables/useKeyboardBarFlicks.ts";
import { useKeyboardBarState } from "../composables/useKeyboardBarState.ts";
import { useQwertyKeyViews } from "../composables/useQwertyKeyViews.ts";
import { emit } from "../app-bridge.ts";
import KeyboardQwertyKey from "./KeyboardQwertyKey.vue";
import KeyboardInput from "./KeyboardInput.vue";
import SendSnippet from "./SendSnippet.vue";
import SendHistory from "./SendHistory.vue";

const props = defineProps({
  isPanelBottom: { type: Boolean, default: false },
});

// モバイル幅（isPanelBottom）でのみ表示する。分割モード（isSplitMode）は
// PC幅でも成立するため、以前はそちらでも表示していたが、キーボードバーは
// モバイル専用機能として扱う。
const isVisible = computed(() => props.isPanelBottom);

const { clearModifiers, sendKeyToTerminal, modifierState, setupFlickRepeat, getActiveTerminalTab } = useKeyboard();

const keyboardInput = ref<InstanceType<typeof KeyboardInput> | null>(null);
const barArrowFlickEl = ref<HTMLElement | null>(null);
const barEnterFlickEl = ref<HTMLElement | null>(null);

// ─── 入力 / スニペット状態・キーボード開閉 ──────────────────────
const {
  isFullKeyboard, draft, inputFocused, showSnippetView, snippetPanelView, hasDraft,
  onInputFocused, openSnippetPanel, openHistoryPanel, closeSnippetPanel,
  hideInput, dismissKeyboard, onSubmitted,
} = useKeyboardBarState({ keyboardInput, clearModifiers });

// フリック矢印キー・KeyboardInput.vueの物理矢印キー入力の両方でこの
// 単一インスタンスを使う（historyIndexを共有するため。別々に生成すると
// 片方で辿った履歴位置をもう片方が知らず、混ぜて使った時に履歴が正しく
// 辿れなくなる）。
const { historyPrev, historyNext } = useInputDraftHistory(draft);

function doReload() {
  window.location.replace(window.location.pathname + "?_=" + Date.now());
}

function onQuickKeyCancel(e: Event) {
  (e.currentTarget as HTMLElement).classList.remove("pressed");
}

// isFullKeyboard 中、入力フォームの代わりに表示する shift/ctrl/space（bar行）。
// showFnView は上段タブ（Fn）とKeyboardQwertyKey.vueへのexternal-fn-view propで共有する
// （modifierStateはモジュール単位のシングルトン）。
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

// フル（QWERTY）キーボードを閉じたら fn ビュー（数字/記号パッド）・
// History/Snippetオーバーレイも閉じる（タブ帯自体もisFullKeyboardの間だけ
// 表示するため、再度開いた時は毎回QWERTYグリッドから始まるようにする）。
watch(isFullKeyboard, (active) => {
  if (!active) {
    showFnView.value = false;
    closeSnippetPanel();
  }
});

// QWERTYタブ: タブ帯自体がisFullKeyboard中しか出ないため、既にキーボードは
// 開いている前提。Fn/History/Snippet表示中ならそれを閉じて通常のQWERTY
// グリッドに戻すだけで、タップしてもキーボード自体は閉じない
// （閉じる操作は右端の×ボタンに一本化）。
function onQwertyTabClick() {
  showFnView.value = false;
  closeSnippetPanel();
}

// Fnタブ: fnビューはフルキーボードの中でのみ意味を持つため、未展開なら
// 先に展開してからfnビューを開く（隅の鍵盤トグルキーのtap=dismissKeyboardと
// 同じ「閉じている状態からの開き方」に揃える）。他のタブと同じく選択式
// （トグルではない）にするため、既にFn表示中の再タップでは閉じない。
function onFnTabClick() {
  if (!isFullKeyboard.value) {
    isFullKeyboard.value = true;
    closeSnippetPanel();
    clearModifiers();
  }
  if (!showFnView.value) toggleFnView();
}

// モード切替タブの定義（並び＝表示順）。aria-label / data-tooltip は
// 可視ラベルと同一文言。active判定・クリック時の遷移は下の2関数で揃える。
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
  setupFlickRepeat, sendKeyToTerminal, dismissKeyboard,
});
</script>

<style>
@import "../styles/keyboard-bar.css";
</style>
