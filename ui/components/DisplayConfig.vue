<template>
  <div class="modal-scroll-body">
    <div class="settings-item">
      <span class="settings-item-label">Narrow screen（折りたたみ時・縦持ちスマホ等）</span>
      <span class="settings-note">画面幅が {{ MOBILE_BREAKPOINT_PX }}px 以下の時の表示。</span>
      <div class="display-settings-radio-row">
        <label class="form-check-label"><input type="radio" v-model="layoutPrefs.narrowTabPosition" value="top" /> Tab bar: Top</label>
        <label class="form-check-label"><input type="radio" v-model="layoutPrefs.narrowTabPosition" value="bottom" /> Bottom</label>
      </div>
      <div class="display-settings-radio-row">
        <label class="form-check-label"><input type="checkbox" v-model="layoutPrefs.narrowKeyboardBar" /> Show keyboard bar</label>
      </div>
    </div>
    <div class="settings-item">
      <span class="settings-item-label">Wide screen（展開時・PC等）</span>
      <span class="settings-note">画面幅が {{ MOBILE_BREAKPOINT_PX }}px を超える時の表示。</span>
      <div class="display-settings-radio-row">
        <label class="form-check-label"><input type="radio" v-model="layoutPrefs.wideTabPosition" value="top" /> Tab bar: Top</label>
        <label class="form-check-label"><input type="radio" v-model="layoutPrefs.wideTabPosition" value="bottom" /> Bottom</label>
      </div>
      <div class="display-settings-radio-row">
        <label class="form-check-label"><input type="checkbox" v-model="layoutPrefs.wideKeyboardBar" /> Show keyboard bar</label>
      </div>
    </div>
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
import { useLayoutPrefs } from "../composables/useLayoutPrefs.ts";
import { DEBUG_LEVELS, MOBILE_BREAKPOINT_PX } from "../utils/constants.ts";
import { useModalView } from "../composables/useModalView.ts";

const { modalTitle } = useModalView();
const debugMode = useDebugMode();
const debugLevels = useDebugLevels();
const layoutPrefs = useLayoutPrefs();

function toggleLevel(level: string) {
  const next = new Set(debugLevels.value);
  if (next.has(level)) next.delete(level);
  else next.add(level);
  debugLevels.value = next;
}

onMounted(() => { modalTitle!.value = "Display"; });
</script>

<style scoped>
.display-settings-radio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
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
