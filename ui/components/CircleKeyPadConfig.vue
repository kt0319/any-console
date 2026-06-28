<template>
  <div class="modal-scroll-body ckpad-cfg">
    <div v-if="!radial.loaded" class="text-muted-center">Loading...</div>
    <template v-else>
      <div class="ckpad-cfg-section">
        <label class="ckpad-cfg-enable">
          <input type="checkbox" v-model="radial.enabled">
          Enable Circle Key Pad
        </label>
      </div>

      <div class="ckpad-cfg-section">
        <div class="ckpad-cfg-section-title">Directional keys</div>
        <p class="ckpad-cfg-desc">8 keys around the ring, clockwise from north.</p>
        <div v-for="(k, i) in radial.keys" :key="i" class="ckpad-cfg-row">
          <span class="ckpad-cfg-dir">{{ directions[i] }}</span>
          <select class="form-input ckpad-cfg-select" :value="keyId(k)" @change="setKey(i, $event.target.value)">
            <option v-for="p in keyPresets" :key="p.id" :value="p.id">{{ p.label }} ({{ presetDescription(p) }})</option>
          </select>
        </div>
      </div>

      <div class="ckpad-cfg-section">
        <div class="ckpad-cfg-section-title">Corner actions</div>
        <p class="ckpad-cfg-desc">Special buttons outside the ring.</p>
        <div v-for="(s, i) in radial.specials" :key="i" class="ckpad-cfg-row">
          <span class="ckpad-cfg-dir">{{ corners[i] }}</span>
          <select class="form-input ckpad-cfg-select" :value="specialId(s)" @change="setSpecial(i, $event.target.value)">
            <option v-for="p in specialPresets" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
      </div>

      <div class="ckpad-cfg-actions">
        <button type="button" @click="reset">Reset to defaults</button>
        <button type="button" class="primary" :disabled="saving" @click="save">{{ saving ? "Saving..." : "Save" }}</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { inject, ref } from "vue";
import { useCircleKeyPadConfigStore } from "../stores/circle-keypad-config.js";
import {
  RADIAL_KEY_PRESETS,
  RADIAL_SPECIAL_PRESETS,
  RADIAL_DIRECTION_LABELS,
  RADIAL_CORNER_LABELS,
  findKeyPreset,
  findSpecialPreset,
} from "../utils/circle-keypad-presets.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Circle Key Pad";

const radial = useCircleKeyPadConfigStore();
const keyPresets = RADIAL_KEY_PRESETS;
const specialPresets = RADIAL_SPECIAL_PRESETS;
const directions = RADIAL_DIRECTION_LABELS;
const corners = RADIAL_CORNER_LABELS;
const saving = ref(false);

if (!radial.loaded) radial.load();

function keyId(k) {
  return RADIAL_KEY_PRESETS.find((p) =>
    p.keyDef.key === k.key
    && !!p.keyDef.ctrl === !!k.ctrl
    && !!p.keyDef.shift === !!k.shift
  )?.id || "";
}

function specialId(s) {
  return RADIAL_SPECIAL_PRESETS.find((p) =>
    p.action === s.action
    && JSON.stringify(p.payload || null) === JSON.stringify(s.payload || null)
  )?.id || "";
}

function presetDescription(p) {
  const parts = [];
  if (p.keyDef.ctrl) parts.push("Ctrl");
  if (p.keyDef.shift) parts.push("Shift");
  parts.push(p.keyDef.key);
  return parts.join("+");
}

function setKey(i, id) {
  const p = findKeyPreset(id);
  if (!p) return;
  radial.keys[i] = { ...p.keyDef, label: p.label };
}

function setSpecial(i, id) {
  const p = findSpecialPreset(id);
  if (!p) return;
  radial.specials[i] = { label: p.label, action: p.action, payload: p.payload || null };
}

function reset() {
  radial.resetToDefaults();
}

async function save() {
  saving.value = true;
  try {
    await radial.save();
  } finally {
    saving.value = false;
  }
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

.ckpad-cfg-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding: 8px 4px 16px;
}

.ckpad-cfg-actions button {
  flex: 1;
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
