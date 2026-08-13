<template>
  <div
    class="output-container"
    :class="splitContainerClasses"
  >
    <TerminalSplitDropZones v-if="isShowDropZones" />

    <template v-if="!isSplitMode">
      <TerminalPane
        v-for="tab in openTabs"
        v-show="tab.id === activeTabId"
        :key="tab.id"
        :tab="tab"
        ref="paneRefs"
      />
    </template>
    <template v-else>
      <template v-if="splitLayout === 'grid'">
        <div v-for="(row, ri) in gridRows" :key="'row-' + ri" class="split-row">
          <template v-for="pane in row" :key="pane.tabId">
            <SplitEmptyPane
              v-if="isEmptyPaneId(pane.tabId)"
              :pane-index="pane.globalIndex"
              :class="['split-pane', 'pane-' + pane.globalIndex, { 'active-pane': pane.globalIndex === activePaneIndex }]"
              @select-pane="selectPane"
            />
            <TerminalPane
              v-else
              :tab="getTabById(pane.tabId)"
              :pane-index="pane.globalIndex"
              :class="['split-pane', 'pane-' + pane.globalIndex, { 'active-pane': pane.globalIndex === activePaneIndex }]"
              @select-pane="selectPane"
              ref="paneRefs"
            />
          </template>
        </div>
      </template>
      <template v-else>
        <template v-for="(tabId, idx) in splitPaneTabIds" :key="tabId">
          <SplitEmptyPane
            v-if="isEmptyPaneId(tabId)"
            :pane-index="idx"
            :class="['split-pane', 'pane-' + idx, { 'active-pane': idx === activePaneIndex }]"
            @select-pane="selectPane"
          />
          <TerminalPane
            v-else
            :tab="getTabById(tabId)"
            :pane-index="idx"
            :class="['split-pane', 'pane-' + idx, { 'active-pane': idx === activePaneIndex }]"
            @select-pane="selectPane"
            ref="paneRefs"
          />
        </template>
      </template>
    </template>
    <slot />
  </div>
</template>

<script setup>
import TerminalPane from "./TerminalPane.vue";
import SplitEmptyPane from "./SplitEmptyPane.vue";
import TerminalSplitDropZones from "./TerminalSplitDropZones.vue";
import { isEmptyPaneId } from "../utils/empty-pane.ts";
import { useTerminalSplitPanes } from "../composables/useTerminalSplitPanes.js";

defineProps({
  isPanelBottom: { type: Boolean, default: false },
});

const {
  paneRefs,
  openTabs,
  activeTabId,
  isSplitMode,
  splitLayout,
  splitPaneTabIds,
  activePaneIndex,
  isShowDropZones,
  splitContainerClasses,
  gridRows,
  getTabById,
  selectPane,
  fitAllTerminals,
} = useTerminalSplitPanes();

defineExpose({ fitAllTerminals, selectPane });
</script>

<style scoped>
.output-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.output-container.split-active {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.output-container.split-active > :deep(.output-area),
.output-container.split-active > :deep(.terminal-frame) {
  display: none;
}

.split-row {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  gap: 2px;
}

.split-pane {
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  flex: 1;
  border: 1px solid #2a2e42;
}

.split-pane.active-pane {
  border-color: var(--accent);
}

.split-pane :deep(.terminal-frame),
.split-pane :deep(.output-area) {
  position: absolute;
  inset: 0;
}

.output-container.split-vertical {
  flex-direction: column;
}

.output-container.split-vertical > .split-pane {
  flex: 1;
  min-height: 0;
}

.output-container.split-horizontal {
  flex-direction: row;
}

.output-container.split-horizontal > .split-pane {
  flex: 1;
  min-width: 0;
}

/* モバイルは常に上下レイアウト（split-horizontal より後ろで上書き） */
.output-container.split-mobile {
  flex-direction: column;
}

.output-container.split-mobile > .split-pane {
  flex: 1;
  min-height: 0;
}
</style>
