<template>
  <div class="terminal-settings-view">
    <template v-for="(schema, key) in TERMINAL_SETTINGS_SCHEMA" :key="key">
      <div v-if="schema.type === 'number'" class="terminal-settings-item">
        <div class="terminal-settings-item-header">
          <span class="terminal-settings-item-label">{{ schema.label }}</span>
        </div>
        <div class="terminal-settings-control-row">
          <button type="button" class="terminal-font-size-step-btn" :disabled="currentValues[key] <= schema.min" @click="stepValue(key, -1)">-</button>
          <input
            type="number"
            class="form-input terminal-font-size-input"
            :min="schema.min"
            :max="schema.max"
            :step="schema.step || 1"
            :value="currentValues[key]"
            inputmode="numeric"
            @change="commitValue(key, $event.target.value)"
          />
          <button type="button" class="terminal-font-size-step-btn" :disabled="currentValues[key] >= schema.max" @click="stepValue(key, 1)">+</button>
        </div>
        <div class="terminal-settings-value">{{ currentValues[key] }}{{ schema.unit || '' }}</div>
        <div v-if="schema.note" class="terminal-settings-note">{{ schema.note }}</div>
      </div>
      <label v-else-if="schema.type === 'boolean'" class="terminal-settings-item terminal-settings-toggle">
        <div class="terminal-settings-toggle-copy">
          <span class="terminal-settings-item-label">{{ schema.label }}</span>
          <span v-if="schema.note" class="terminal-settings-note">{{ schema.note }}</span>
        </div>
        <input type="checkbox" :checked="currentValues[key]" @change="commitValue(key, $event.target.checked)" />
      </label>
    </template>
    <div class="terminal-settings-actions">
      <button type="button" class="terminal-settings-reset-btn" @click="resetAll">初期値に戻す</button>
    </div>
  </div>
</template>

<script setup>
import { reactive, inject } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { emit } from "../app-bridge.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "ターミナル";

const terminalStore = useTerminalStore();
const TERMINAL_SETTINGS_SCHEMA = terminalStore.TERMINAL_SETTINGS_SCHEMA;
const currentValues = reactive({ ...terminalStore.terminalSettings });

function syncFromStore() {
  Object.assign(currentValues, terminalStore.terminalSettings);
}

function commitValue(key, rawValue) {
  const next = terminalStore.setTerminalSetting(key, rawValue);
  if (next != null) {
    currentValues[key] = next;
    emit("terminal:settingChanged", { key, value: next });
  }
}

function stepValue(key, direction) {
  const schema = TERMINAL_SETTINGS_SCHEMA[key];
  const step = schema.step || 1;
  commitValue(key, currentValues[key] + step * direction);
}

function resetAll() {
  terminalStore.resetTerminalSettings();
  syncFromStore();
  emit("terminal:settingsReset");
}
</script>

<style scoped>
.terminal-settings-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.terminal-settings-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
}

.terminal-settings-item-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.terminal-settings-toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.terminal-settings-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.terminal-settings-toggle input[type="checkbox"] {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
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

.terminal-settings-note {
  font-size: 12px;
  color: var(--text-muted);
}

.terminal-settings-actions {
  display: flex;
  justify-content: flex-end;
}

.terminal-settings-reset-btn {
  min-height: 40px;
}
</style>
