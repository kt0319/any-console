<template>
  <input
    ref="searchInput"
    :value="query"
    class="form-input command-palette-input"
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
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import { useCommandPalette } from "../composables/useCommandPalette.ts";
import { commandPaletteOptionId } from "../utils/command-palette.ts";
import { isComposingEvent, runUnlessComposing } from "../utils/keyboard-event.ts";

// コマンドパレットの検索入力。セッションサイドバーを開いている間だけ TabBar.vue が
// タブの代わりに（モバイル）／タブの左に（PC）表示する。結果リストは
// サイドバー本体（SessionListPanel.vue）が同じ検索状態（useCommandPalette.ts）から描画する。

const { searchFocusRequested, isSearchFocused } = useSessionListOverlay();
const { query, activeIndex, isSearching, resultsFromBottom, results, setQuery, moveActive, runItem } = useCommandPalette();

const searchInput = ref<HTMLInputElement | null>(null);

// 開く要求のフォーカス待ちを消費する。モバイルのオーバーレイは useModal が開いた直後に
// 最初のフォーカス可能要素へフォーカスするため、その後（nextTick 後）に奪い返す。
async function focusSearchIfRequested() {
  if (!searchFocusRequested.value) return;
  searchFocusRequested.value = false;
  await nextTick();
  searchInput.value?.focus();
}

onMounted(focusSearchIfRequested);
watch(searchFocusRequested, focusSearchIfRequested);
onBeforeUnmount(() => { isSearchFocused.value = false; });

// 下から積む表示では、見た目の「上」が次の候補になるため矢印の向きを反転する。
function onArrow(e: KeyboardEvent, delta: number) {
  if (!isSearching.value) return;
  runUnlessComposing(e, () => moveActive(resultsFromBottom.value ? -delta : delta));
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
.command-palette-input {
  min-height: 36px;
  font-size: 13px;
  box-sizing: border-box;
}
</style>
