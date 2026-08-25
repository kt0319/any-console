<template>
  <div class="browser-tabs-view">
    <BrowserPane
      v-for="tab in browserTabStore.tabs"
      :key="tab.id"
      :class="{ 'browser-pane-active': tab.id === browserTabStore.activeBrowserTabId }"
      :url="tab.url"
      :tab-id="tab.id"
      :label="tab.label"
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
  position: relative;
}

/* v-show（display:none）で非アクティブなiframeを隠すと、モバイルSafari
   （WebKit）ではdisplay:noneで非表示にしたiframeが再表示時に描画内容を
   失い真っ白に戻ってしまうことがある。display には触れず、絶対配置で
   重ねた上でvisibilityだけ切り替える（要素はレンダーツリーに残るため
   この既知の挙動を避けられる）。 */
:deep(.browser-pane) {
  position: absolute;
  inset: 0;
  visibility: hidden;
}

:deep(.browser-pane.browser-pane-active) {
  visibility: visible;
}
</style>
