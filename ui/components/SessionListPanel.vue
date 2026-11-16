<template>
  <div class="settings-panel">
    <ModalHeader
      title="Sessions"
      close-label="Close sessions panel"
      :panel-bottom="panelBottom"
      @close="close"
    />
    <div class="settings-panel-body pane-fill" :class="{ 'panel-bottom': panelBottom }">
      <div class="session-list-search">
        <input
          ref="searchInput"
          :value="query"
          class="form-input session-list-search-input"
          type="text"
          role="combobox"
          aria-label="Search commands, tabs and jobs"
          :aria-controls="isSearching ? 'command-palette-list' : undefined"
          :aria-expanded="isSearching"
          :aria-activedescendant="isSearching && results.length ? commandPaletteOptionId(activeIndex) : undefined"
          placeholder="Search commands, tabs and jobs"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          @focus="isSearchFocused = true"
          @blur="isSearchFocused = false"
          @input="setQuery(($event.target as HTMLInputElement).value)"
          @keydown.down="onArrow($event, 1)"
          @keydown.up="onArrow($event, -1)"
          @keydown.enter="onEnter"
          @keydown.esc="onEscape"
        />
      </div>
      <CommandPaletteResults v-if="isSearching" :results="results" :active-index="activeIndex" @select="runItem" />
      <SessionListView v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import { useCommandPalette } from "../composables/useCommandPalette.ts";
import { commandPaletteOptionId } from "../utils/command-palette.ts";
import { isComposingEvent, runUnlessComposing } from "../utils/keyboard-event.ts";
import ModalHeader from "./ModalHeader.vue";
import CommandPaletteResults from "./CommandPaletteResults.vue";
import SessionListView from "./SessionListView.vue";

// SessionListOverlay.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使うセッション一覧の中身。検索入力が空の間はSessionListView.vueを
// そのまま表示し、入力があるときだけコマンドパレット（CommandPaletteResults.vue）の
// 結果に差し替える。ヘッダーはModalShell.vueと共通のModalHeader.vue（タイトル+閉じる
// ボタン。戻る機能は無いのでcanBackは渡さない＝falseのまま）。
// panelBottomは呼び出し元がヘッダーを上部/下部どちらに寄せるか渡す
// （SessionListOverlay.vue経由＝実際のタブ位置設定、SessionSidebar.vue経由＝常にfalse
// 固定。インラインサイドバーは常に上部固定のため）。

defineProps<{
  panelBottom?: boolean,
}>();

const { close, searchFocusRequested, isSearchFocused } = useSessionListOverlay();
const { query, activeIndex, isSearching, results, setQuery, moveActive, runItem } = useCommandPalette();

const searchInput = ref<HTMLInputElement | null>(null);

// 開く要求のフォーカス待ちを消費する。モバイルのオーバーレイは useModal が開いた直後に
// 最初のフォーカス可能要素（閉じるボタン）へフォーカスするため、その後（nextTick 後）に奪い返す。
async function focusSearchIfRequested() {
  if (!searchFocusRequested.value) return;
  searchFocusRequested.value = false;
  await nextTick();
  searchInput.value?.focus();
}

onMounted(focusSearchIfRequested);
onBeforeUnmount(() => { isSearchFocused.value = false; });
watch(searchFocusRequested, focusSearchIfRequested);

function onArrow(e: KeyboardEvent, delta: number) {
  if (!isSearching.value) return;
  runUnlessComposing(e, () => moveActive(delta));
}

function onEnter(e: KeyboardEvent) {
  if (!isSearching.value) return;
  runUnlessComposing(e, () => runItem(results.value[activeIndex.value]));
}

// 入力があるときの Esc は入力のクリア（サイドバーの Esc クローズへは伝えない）。
function onEscape(e: KeyboardEvent) {
  if (isComposingEvent(e) || !isSearching.value) return;
  e.preventDefault();
  setQuery("");
}
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.settings-panel-header {
  order: 0;
}

.settings-panel-header.panel-bottom {
  order: 1;
}

.settings-panel-body {
  order: 1;
}

.settings-panel-body.panel-bottom {
  order: 0;
}

.session-list-search {
  flex-shrink: 0;
  padding: 6px 8px;
}

.session-list-search-input {
  width: 100%;
  min-height: 36px;
  font-size: 13px;
  box-sizing: border-box;
}
</style>
