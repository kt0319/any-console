<template>
  <div class="modal-scroll-body">
    <label class="settings-item settings-toggle">
      <input type="checkbox" v-model="debugMode" />
      <div class="settings-toggle-copy">
        <span class="settings-item-label">Debug mode</span>
        <span class="settings-note">Show real-time logs (WS / API / events) in the title bar instead of the tab title.</span>
      </div>
    </label>
    <div class="settings-item" :class="{ 'display-settings-disabled': !debugMode }">
      <span class="settings-item-label">Log levels</span>
      <div class="display-settings-level-list">
        <label v-for="level in DEBUG_LEVELS" :key="level" class="display-settings-level-item">
          <input type="checkbox" :checked="debugLevels.has(level)" :disabled="!debugMode" @change="toggleLevel(level)" />
          <span :class="`debug-level-label debug-level-${level}`">{{ level }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useDebugMode, useDebugLevels } from "../composables/useDebugMode.ts";
import { DEBUG_LEVELS } from "../utils/constants.ts";
import { useModalView } from "../composables/useModalView.ts";

const { modalTitle } = useModalView();
const debugMode = useDebugMode();
const debugLevels = useDebugLevels();

function toggleLevel(level: string) {
  const next = new Set(debugLevels.value);
  if (next.has(level)) next.delete(level);
  else next.add(level);
  debugLevels.value = next;
}

onMounted(() => { modalTitle!.value = "Display"; });
</script>

<style scoped>
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
  accent-color: var(--accent);
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
