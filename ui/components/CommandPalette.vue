<template>
  <BaseDialog :visible="visible" :z-index="DIALOG_Z_INDEX_RAISED" initial-focus="none" @dismiss="close">
    <div class="command-palette dialog-box" style="--dialog-width: 520px" role="dialog" aria-modal="true" aria-label="Command palette">
      <input
        ref="inputEl"
        v-model="query"
        class="form-input command-palette-input"
        type="text"
        role="combobox"
        aria-label="Search commands, tabs and jobs"
        aria-controls="command-palette-list"
        aria-expanded="true"
        :aria-activedescendant="results.length ? optionId(activeIndex) : undefined"
        placeholder="Search commands, tabs and jobs"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @keydown.down="(e) => runUnlessComposing(e, () => moveActive(1))"
        @keydown.up="(e) => runUnlessComposing(e, () => moveActive(-1))"
        @keydown.enter="(e) => runUnlessComposing(e, () => runItem(results[activeIndex]))"
      />
      <div id="command-palette-list" class="command-palette-list" role="listbox" aria-label="Results">
        <div
          v-for="(item, index) in results"
          :id="optionId(index)"
          :key="item.id"
          class="command-palette-item hover-bg"
          :class="{ active: index === activeIndex }"
          role="option"
          :aria-selected="index === activeIndex"
          @click="runItem(item)"
        >
          <span :class="`mdi ${item.icon} command-palette-item-icon`" aria-hidden="true"></span>
          <span class="command-palette-item-label">{{ item.label }}</span>
          <span class="command-palette-item-group">{{ item.group }}</span>
        </div>
        <div v-if="!results.length" class="command-palette-empty" role="status">No matches</div>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import BaseDialog from "./BaseDialog.vue";
import { useCommandPalette } from "../composables/useCommandPalette.ts";
import { runUnlessComposing } from "../utils/keyboard-event.ts";
import { DIALOG_Z_INDEX_RAISED } from "../utils/constants.ts";

const { visible, query, activeIndex, results, close, moveActive, runItem } = useCommandPalette();

const inputEl = ref<HTMLInputElement | null>(null);

function optionId(index: number) {
  return `command-palette-option-${index}`;
}

watch(visible, async (nextVisible) => {
  if (!nextVisible) return;
  await nextTick();
  inputEl.value?.focus();
});

watch(activeIndex, async (index) => {
  await nextTick();
  document.getElementById(optionId(index))?.scrollIntoView?.({ block: "nearest" });
});
</script>

<style scoped>
.command-palette {
  gap: 10px;
  padding: 12px;
}

.command-palette-input {
  min-height: 40px;
  font-size: 14px;
}

.command-palette-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 50vh;
  overflow-y: auto;
}

.command-palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.command-palette-item.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.command-palette-item-icon {
  flex-shrink: 0;
  width: 20px;
  font-size: 16px;
  text-align: center;
  color: var(--text-muted);
}

.command-palette-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.command-palette-item-group {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.command-palette-empty {
  padding: 12px 10px;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
