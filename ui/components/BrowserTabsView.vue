<template>
  <div class="browser-tabs-view">
    <BrowserPane
      v-for="tab in browserTabStore.tabs"
      v-show="tab.id === browserTabStore.activeBrowserTabId"
      :key="tab.id"
      :url="tab.url"
      :tab-id="tab.id"
    />
  </div>
</template>

<script setup lang="ts">
import { useBrowserTabStore } from "../stores/browserTabs.ts";
import BrowserPane from "./BrowserPane.vue";

const browserTabStore = useBrowserTabStore();
</script>

<style scoped>
.browser-tabs-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
</style>
