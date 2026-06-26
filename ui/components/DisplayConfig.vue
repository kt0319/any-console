<template>
  <div class="modal-scroll-body">
    <label class="display-settings-item display-settings-toggle">
      <input type="checkbox" v-model="debugMode" />
      <div class="display-settings-toggle-copy">
        <span class="display-settings-item-label">Debug mode</span>
        <span class="display-settings-note">Show real-time logs (WS / API / events) in the title bar instead of the tab title.</span>
      </div>
    </label>
    <div class="display-settings-item" :class="{ 'display-settings-disabled': !debugMode }">
      <span class="display-settings-item-label">Log levels</span>
      <div class="display-settings-level-list">
        <label v-for="level in DEBUG_LEVELS" :key="level" class="display-settings-level-item">
          <input type="checkbox" :checked="debugLevels.has(level)" :disabled="!debugMode" @change="toggleLevel(level)" />
          <span :class="`debug-level-label debug-level-${level}`">{{ level }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject, onMounted } from "vue";
import { useDebugMode, useDebugLevels } from "../composables/useDebugMode.js";
import { DEBUG_LEVELS } from "../utils/constants.js";

const modalTitle = inject("modalTitle");
const debugMode = useDebugMode();
const debugLevels = useDebugLevels();

function toggleLevel(level) {
  const next = new Set(debugLevels.value);
  if (next.has(level)) next.delete(level);
  else next.add(level);
  debugLevels.value = next;
}

onMounted(() => { modalTitle.value = "Display"; });
</script>

<style scoped>
.display-settings-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--border);
  background: transparent;
}

.display-settings-item:last-of-type {
  border-bottom: none;
}

.display-settings-item-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.display-settings-toggle {
  flex-direction: row;
  align-items: center;
  gap: 16px;
  cursor: pointer;
}

.display-settings-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.display-settings-toggle input[type="checkbox"] {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}

.display-settings-note {
  font-size: 12px;
  color: var(--text-muted);
}

.display-settings-level-list {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.display-settings-level-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
}

.display-settings-level-item input[type="checkbox"] {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.debug-level-label { font-weight: 600; }
.debug-level-warn { color: var(--warning); }
.debug-level-error { color: var(--error); }
.debug-level-info { color: var(--accent); }
.debug-level-log { color: var(--text-secondary); }

.display-settings-disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>
