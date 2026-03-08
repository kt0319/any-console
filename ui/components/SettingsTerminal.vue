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
import { reactive } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { emit } from "../app-bridge.js";

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
