<template>
  <div class="split-tab-mode-row">
    <button
      v-for="m in visibleModes"
      :key="m.value"
      type="button"
      class="split-tab-mode-option"
      :class="{ active: currentMode === m.value }"
      :disabled="m.minTabs > tabCount"
      :aria-label="m.label"
      :title="m.label"
      :aria-pressed="currentMode === m.value ? 'true' : 'false'"
      @click="$emit('select', m.value)"
    >
      <span :class="m.icon" aria-hidden="true"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useIsMobile } from "../composables/useIsMobile.ts";

defineProps({
  currentMode: { type: String, required: true },
  tabCount: { type: Number, required: true },
});

defineEmits(["select"]);

const { isMobile } = useIsMobile();

const modes = [
  { value: "normal", icon: "split-icon-normal", minTabs: 0, label: "Single pane" },
  { value: "vertical", icon: "split-icon-v", minTabs: 2, label: "Vertical split" },
  { value: "horizontal", icon: "split-icon-h", minTabs: 2, label: "Horizontal split" },
  { value: "grid", icon: "split-icon-grid", minTabs: 3, label: "Grid split" },
];

// モバイルではレイアウトを Single pane / Vertical split のみに絞る
const visibleModes = computed(() =>
  isMobile.value ? modes.filter((m) => m.value === "normal" || m.value === "vertical") : modes,
);
</script>

<style scoped>
.split-tab-mode-row {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  flex-shrink: 0;
  margin-bottom: 8px;
}

.split-tab-mode-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
}

.split-tab-mode-option.active {
  background: var(--accent-bg-12);
  color: var(--accent);
}

.split-tab-mode-option:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

[class^="split-icon-"] {
  display: inline-block;
  width: 16px;
  height: 14px;
  vertical-align: middle;
  border: 1.5px solid currentColor;
  border-radius: 1px;
  position: relative;
}

.split-icon-h::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: currentColor;
  transform: translateX(-50%);
}

.split-icon-v::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1.5px;
  background: currentColor;
  transform: translateY(-50%);
}

.split-icon-grid::before,
.split-icon-grid::after {
  content: "";
  position: absolute;
  background: currentColor;
}

.split-icon-grid::before {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1.5px;
  transform: translateX(-50%);
}

.split-icon-grid::after {
  top: 50%;
  left: 0;
  right: 0;
  height: 1.5px;
  transform: translateY(-50%);
}
</style>
