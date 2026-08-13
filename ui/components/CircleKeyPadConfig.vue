<template>
  <div class="modal-scroll-body ckpad-cfg">
    <div v-if="!circleKeypad.loaded" class="text-muted-center">Loading...</div>
    <template v-else>
      <div class="ckpad-cfg-section">
        <label class="ckpad-cfg-enable">
          <input type="checkbox" :checked="circleKeypad.enabled" @change="setEnabled($event.target.checked)">
          Enable Circle Keypad
        </label>
      </div>

      <div class="ckpad-cfg-section">
        <div class="ckpad-cfg-section-title">Directional keys</div>
        <p class="ckpad-cfg-desc">8 keys around the ring, clockwise from north.</p>
        <div v-for="(k, i) in circleKeypad.keys" :key="i" class="ckpad-cfg-row">
          <span class="ckpad-cfg-dir">{{ directions[i] }}</span>
          <select class="form-input ckpad-cfg-select ckpad-cfg-select-modifier" :value="modifierIdOf(k)" @change="setModifier(i, $event.target.value)">
            <option v-for="m in modifierOptions" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <select class="form-input ckpad-cfg-select" :value="baseKeyIdOf(k)" @change="setBaseKey(i, $event.target.value)">
            <option v-for="bk in baseKeys" :key="bk.id" :value="bk.id">{{ bk.label }}</option>
          </select>
        </div>
      </div>

      <div class="ckpad-cfg-section">
        <div class="ckpad-cfg-section-title">Corner actions</div>
        <p class="ckpad-cfg-desc">Special buttons outside the ring.</p>
        <div v-for="(s, i) in circleKeypad.specials" :key="i" class="ckpad-cfg-row">
          <span class="ckpad-cfg-dir">{{ corners[i] }}</span>
          <select class="form-input ckpad-cfg-select" :value="specialId(s)" @change="setSpecial(i, $event.target.value)">
            <option v-for="p in specialPresets" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
      </div>

      <div class="ckpad-cfg-actions">
        <button type="button" class="ckpad-cfg-reset-btn" @click="reset">Reset to defaults</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { useCircleKeyPadConfigStore } from "../stores/circle-keypad-config.ts";
import { useModalView } from "../composables/useModalView.ts";
import {
  CIRCLE_KEYPAD_MODIFIER_OPTIONS,
  CIRCLE_KEYPAD_BASE_KEYS,
  CIRCLE_KEYPAD_SPECIAL_PRESETS,
  CIRCLE_KEYPAD_DIRECTION_LABELS,
  CIRCLE_KEYPAD_CORNER_LABELS,
  findModifierOption,
  findSpecialPreset,
  modifierIdOf,
  baseKeyIdOf,
  circleKeypadKeyLabel,
} from "../utils/circle-keypad-presets.ts";

const { modalTitle } = useModalView();
modalTitle.value = "Circle Keypad";

const circleKeypad = useCircleKeyPadConfigStore();
const modifierOptions = CIRCLE_KEYPAD_MODIFIER_OPTIONS;
const baseKeys = CIRCLE_KEYPAD_BASE_KEYS;
const specialPresets = CIRCLE_KEYPAD_SPECIAL_PRESETS;
const directions = CIRCLE_KEYPAD_DIRECTION_LABELS;
const corners = CIRCLE_KEYPAD_CORNER_LABELS;

if (!circleKeypad.loaded) circleKeypad.load();

function specialId(s) {
  return CIRCLE_KEYPAD_SPECIAL_PRESETS.find((p) =>
    p.action === s.action
    && JSON.stringify(p.payload || null) === JSON.stringify(s.payload || null)
  )?.id || "";
}

function setEnabled(v) {
  circleKeypad.enabled = v;
  circleKeypad.save();
}

function setModifier(i, modifierId) {
  const mod = findModifierOption(modifierId);
  const k = circleKeypad.keys[i];
  const key = baseKeyIdOf(k);
  circleKeypad.keys[i] = { key, ctrl: mod.ctrl, shift: mod.shift, alt: mod.alt, label: circleKeypadKeyLabel(modifierId, key) };
  circleKeypad.save();
}

function setBaseKey(i, keyId) {
  const k = circleKeypad.keys[i];
  const modifierId = modifierIdOf(k);
  circleKeypad.keys[i] = { key: keyId, ctrl: !!k.ctrl, shift: !!k.shift, alt: !!k.alt, label: circleKeypadKeyLabel(modifierId, keyId) };
  circleKeypad.save();
}

function setSpecial(i, id) {
  const p = findSpecialPreset(id);
  if (!p) return;
  circleKeypad.specials[i] = { label: p.label, action: p.action, payload: p.payload || null };
  circleKeypad.save();
}

function reset() {
  circleKeypad.resetToDefaults();
  circleKeypad.save();
}
</script>

<style scoped>
.ckpad-cfg-section + .ckpad-cfg-section {
  margin-top: 16px;
}

.ckpad-cfg-section-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  padding: 8px 4px 4px;
}

.ckpad-cfg-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0 4px 8px;
}

.ckpad-cfg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 4px;
}

.ckpad-cfg-dir {
  flex-shrink: 0;
  width: 88px;
  font-size: 13px;
  color: var(--text-secondary);
}

.ckpad-cfg-select {
  flex: 1;
  min-width: 0;
}

.ckpad-cfg-select-modifier {
  flex: 0 0 40%;
}

.ckpad-cfg-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding: 8px 4px 16px;
}

.ckpad-cfg-reset-btn {
  min-height: 40px;
}

.ckpad-cfg-enable {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.ckpad-cfg-enable input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent, currentColor);
}
</style>
