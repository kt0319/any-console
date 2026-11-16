<template>
  <div class="settings-panel">
    <div class="settings-panel-body pane-fill">
      <CommandPaletteResults v-if="isSearching" :results="results" :active-index="activeIndex" :from-bottom="resultsFromBottom" @select="runItem" />
      <SessionListView v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCommandPalette } from "../composables/useCommandPalette.ts";
import CommandPaletteResults from "./CommandPaletteResults.vue";
import SessionListView from "./SessionListView.vue";

// SessionListOverlay.vue（モバイルのオーバーレイ表示）とSessionSidebar.vue（PCのインライン
// 表示）の両方から使うセッション一覧の中身。検索入力（コマンドパレット、CommandPaletteInput.vue）
// が空の間はSessionListView.vueをそのまま表示し、入力があるときだけ結果
// （CommandPaletteResults.vue）に差し替える。閉じるボタンと検索入力はタブバー
// （TabBar.vue）側にあり、このパネルにヘッダーは持たない。

const { activeIndex, isSearching, resultsFromBottom, results, runItem } = useCommandPalette();
</script>

<style scoped>
.settings-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
</style>
