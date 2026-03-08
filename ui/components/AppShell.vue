<template>
  <div class="app-shell" :class="{ 'panel-bottom': panelBottom }">
    <header class="app-header">
      <WorkspaceHeader ref="workspaceHeader" />
      <TabBar ref="tabBar" />
    </header>

    <main class="app-main">
      <TerminalSplit ref="terminalSplit" />
    </main>

    <footer v-if="panelBottom" class="app-footer">
      <SnippetBar ref="snippetBar" />
      <KeyboardBar ref="keyboardBar" />
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import WorkspaceHeader from "./WorkspaceHeader.vue";
import TabBar from "./TabBar.vue";
import TerminalSplit from "./TerminalSplit.vue";
import SnippetBar from "./SnippetBar.vue";
import KeyboardBar from "./KeyboardBar.vue";
import { useLayoutStore } from "../stores/layout.js";
import { on } from "../app-bridge.js";

const layoutStore = useLayoutStore();

const workspaceHeader = ref(null);
const tabBar = ref(null);
const terminalSplit = ref(null);
const snippetBar = ref(null);
const keyboardBar = ref(null);

const panelBottom = computed(() => layoutStore.panelBottom);

let resizeObserver = null;

onMounted(() => {
  on("layout:fitAll", () => {
    terminalSplit.value?.fitAllTerminals();
  });

  on("layout:toggleSnippet", () => {
    snippetBar.value?.toggle();
  });

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      terminalSplit.value?.fitAllTerminals();
    });
    const main = document.querySelector(".app-main");
    if (main) resizeObserver.observe(main);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

defineExpose({
  tabBar,
  terminalSplit,
  snippetBar,
  keyboardBar,
  workspaceHeader,
});
</script>
