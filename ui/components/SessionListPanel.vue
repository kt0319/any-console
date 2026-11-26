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

// モバイルのオーバーレイとPCのサイドバーで共用。閉じるボタンと検索入力はTabBar.vue側にある。

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
