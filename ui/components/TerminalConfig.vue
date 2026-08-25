<template>
  <div class="terminal-settings-view modal-scroll-body">
    <template v-for="(schema, key) in TERMINAL_SETTINGS_META" :key="key">
      <div v-if="schema.type === 'number'" class="settings-item">
        <div class="settings-item-header">
          <span class="settings-item-label">{{ schema.label }}</span>
        </div>
        <div class="terminal-settings-control-row">
          <button type="button" class="terminal-font-size-step-btn" :disabled="currentValues[key] <= schema.min!" @click="stepValue(key, -1)">-</button>
          <input
            type="number"
            class="form-input terminal-font-size-input"
            :min="schema.min"
            :max="schema.max"
            :step="schema.step || 1"
            :value="currentValues[key]"
            inputmode="numeric"
            @change="commitValue(key, ($event.target as HTMLInputElement).value)"
          />
          <button type="button" class="terminal-font-size-step-btn" :disabled="currentValues[key] >= schema.max!" @click="stepValue(key, 1)">+</button>
        </div>
        <div class="terminal-settings-value">{{ currentValues[key] }}{{ schema.unit || '' }}</div>
        <div v-if="schema.note" class="settings-note">{{ schema.note }}</div>
      </div>
      <label v-else-if="schema.type === 'boolean'" class="settings-item settings-toggle">
        <div class="settings-toggle-copy">
          <span class="settings-item-label">{{ schema.label }}</span>
          <span v-if="schema.note" class="settings-note">{{ schema.note }}</span>
        </div>
        <input type="checkbox" :checked="currentValues[key]" @change="commitValue(key, ($event.target as HTMLInputElement).checked)" />
      </label>
      <div v-else-if="schema.type === 'select'" class="settings-item">
        <div class="settings-item-header">
          <span class="settings-item-label">{{ schema.label }}</span>
        </div>
        <div class="terminal-settings-segmented">
          <button
            v-for="opt in schema.options!"
            :key="opt.value"
            type="button"
            class="terminal-settings-segmented-btn"
            :class="{ active: currentValues[key] === opt.value }"
            @click="commitValue(key, opt.value)"
          >{{ opt.label }}</button>
        </div>
        <div v-if="schema.note" class="settings-note">{{ schema.note }}</div>
      </div>
    </template>
    <div class="terminal-settings-actions">
      <button type="button" class="terminal-settings-reset-btn" @click="resetAll">Reset to Default</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";
import { useTerminalSettingsStore } from "../stores/terminal-settings.ts";
import { useModalView } from "../composables/useModalView.ts";

const { modalTitle } = useModalView();
modalTitle!.value = "Terminal";

// TERMINAL_SETTINGS_META（utils/terminal-settings.ts）はキーごとに形の異なる
// リテラルの union になるため、テンプレートの分岐（schema.type ごとの表示）で
// 使いやすい共通スキーマ型に揃える。
interface TerminalSettingSchema {
  type: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  note?: string;
  options?: { value: string, label: string }[];
}

const settingsStore = useTerminalSettingsStore();
const TERMINAL_SETTINGS_META = settingsStore.TERMINAL_SETTINGS_META as Record<string, TerminalSettingSchema>;
const currentValues = reactive<Record<string, any>>({ ...settingsStore.terminalSettings });

function syncFromStore() {
  Object.assign(currentValues, settingsStore.terminalSettings);
}

function commitValue(key: string, rawValue: unknown) {
  const next = settingsStore.setTerminalSetting(key, rawValue);
  if (next != null) currentValues[key] = next;
}

function stepValue(key: string, direction: number) {
  const schema = TERMINAL_SETTINGS_META[key];
  const step = schema.step || 1;
  commitValue(key, currentValues[key] + step * direction);
}

function resetAll() {
  settingsStore.resetTerminalSettings();
  syncFromStore();
}
</script>

<style scoped>
.terminal-settings-view {
  display: flex;
  flex-direction: column;
}

.terminal-settings-control-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.terminal-font-size-step-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  border-radius: 10px;
  font-size: 20px;
  line-height: 1;
  flex: 0 0 auto;
}

.terminal-font-size-input {
  width: 92px;
  flex: 1 1 auto;
  text-align: right;
}

.terminal-settings-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.terminal-settings-segmented {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.terminal-settings-segmented-btn {
  flex: 1 1 0;
  min-width: 80px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.terminal-settings-segmented-btn.active {
  border-color: var(--accent, #82aaff);
  background: var(--accent-bg-12);
  color: var(--accent, #82aaff);
}

.terminal-settings-actions {
  display: flex;
  justify-content: flex-end;
}

.terminal-settings-reset-btn {
  min-height: 40px;
}
</style>
