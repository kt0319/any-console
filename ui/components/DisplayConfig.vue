<template>
  <div class="modal-scroll-body">
    <div class="settings-note display-settings-device-note">
      <span class="mdi mdi-cellphone-cog" aria-hidden="true"></span>
      These settings are saved on this device only and are not synced across your other devices.
    </div>
    <div class="settings-item">
      <span class="settings-item-label">Wide screen (unfolded / PC, etc.)</span>
      <span class="settings-note">Applies when the screen width is greater than {{ MOBILE_BREAKPOINT_PX }}px.</span>
      <div class="display-settings-field">
        <span class="display-settings-field-label">Tab bar</span>
        <div class="display-settings-radio-row">
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.wideTabPosition" value="top" /> Top</label>
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.wideTabPosition" value="bottom" /> Bottom</label>
        </div>
      </div>
      <div class="display-settings-field">
        <span class="display-settings-field-label">Title bar</span>
        <div class="display-settings-radio-row">
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.wideTitleBarPosition" value="off" /> Off</label>
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.wideTitleBarPosition" value="top" /> Top</label>
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.wideTitleBarPosition" value="bottom" /> Bottom</label>
        </div>
      </div>
      <div class="display-settings-field">
        <label class="form-check-label"><input type="checkbox" v-model="layoutPrefs.wideKeyboardBar" /> Show keyboard bar</label>
      </div>
    </div>
    <div class="settings-item">
      <span class="settings-item-label">Narrow screen (folded / portrait phone, etc.)</span>
      <span class="settings-note">Applies when the screen width is {{ MOBILE_BREAKPOINT_PX }}px or less.</span>
      <div class="display-settings-field">
        <span class="display-settings-field-label">Tab bar</span>
        <div class="display-settings-radio-row">
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.narrowTabPosition" value="top" /> Top</label>
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.narrowTabPosition" value="bottom" /> Bottom</label>
        </div>
      </div>
      <div class="display-settings-field">
        <span class="display-settings-field-label">Title bar</span>
        <div class="display-settings-radio-row">
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.narrowTitleBarPosition" value="off" /> Off</label>
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.narrowTitleBarPosition" value="top" /> Top</label>
          <label class="form-check-label"><input type="radio" v-model="layoutPrefs.narrowTitleBarPosition" value="bottom" /> Bottom</label>
        </div>
      </div>
      <div class="display-settings-field">
        <label class="form-check-label"><input type="checkbox" v-model="layoutPrefs.narrowKeyboardBar" /> Show keyboard bar</label>
      </div>
    </div>
    <label class="settings-item settings-toggle">
      <input type="checkbox" v-model="debugMode" />
      <div class="settings-toggle-copy">
        <span class="settings-item-label">Debug mode</span>
        <span class="settings-note">Show real-time logs (WS / API / events) in the title bar instead of the tab title. Requires the title bar to be enabled above (has no effect if set to Off).</span>
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
    <div class="display-settings-actions">
      <button type="button" class="display-settings-reset-btn" @click="resetAll">Reset to defaults</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useDebugMode, useDebugLevels } from "../composables/useDebugMode.ts";
import { useLayoutPrefs } from "../composables/useLayoutPrefs.ts";
import { DEFAULT_LAYOUT_PREFS } from "../utils/layout-prefs.ts";
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

function resetAll() {
  layoutPrefs.value = { ...DEFAULT_LAYOUT_PREFS };
  debugMode.value = false;
  debugLevels.value = new Set(DEBUG_LEVELS);
}

onMounted(() => { modalTitle!.value = "Display"; });
</script>

<style scoped>
.display-settings-device-note {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}

.display-settings-field {
  margin-top: 8px;
}

.display-settings-field-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.display-settings-radio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
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

.display-settings-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.display-settings-reset-btn {
  min-height: 40px;
}
</style>
