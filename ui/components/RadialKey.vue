<template>
  <div
    v-if="state.visible"
    class="radial-key"
    :style="{ left: `${state.originX}px`, top: `${state.originY}px` }"
  >
    <div class="radial-key-ring"></div>
    <div
      v-for="k in keys"
      :key="k.id"
      class="radial-key-item"
      :class="{ active: state.activeId === k.id }"
      :style="itemStyle(k)"
    >{{ k.label }}</div>
    <div
      v-for="b in specials"
      :key="b.id"
      class="radial-key-item special"
      :class="{ active: state.activeId === b.id }"
      :style="specialStyle(b)"
    >{{ b.label }}</div>
  </div>
</template>

<script setup>
import { RADIAL_KEYS, SPECIAL_BUTTONS, SPECIAL_BUTTON_SIZE } from "../composables/useRadialKey.js";

defineProps({
  state: { type: Object, required: true },
});

const keys = RADIAL_KEYS;
const specials = SPECIAL_BUTTONS;

function specialStyle(b) {
  return {
    minWidth: `${SPECIAL_BUTTON_SIZE.width}px`,
    minHeight: `${SPECIAL_BUTTON_SIZE.height}px`,
    transform: `translate(calc(-50% + ${b.offsetX}px), calc(-50% + ${b.offsetY}px))`,
  };
}
// 中央のサークル（リング）半径と、キーボタンを配置する半径を分離する。
// ボタンはリングの外側に並ぶよう RING_RADIUS + ボタン半径 + 余白 で算出。
const RING_RADIUS = 44;
const RADIUS = RING_RADIUS + 44;

function itemStyle(k) {
  const rad = k.angle * (Math.PI / 180);
  const x = Math.cos(rad) * RADIUS;
  const y = Math.sin(rad) * RADIUS;
  return { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` };
}
</script>

<style scoped>
.radial-key {
  position: fixed;
  z-index: 200;
  width: 0;
  height: 0;
  pointer-events: none;
}

.radial-key::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border-radius: 50%;
  background: rgba(130, 170, 255, 0.6);
  border: 1px solid var(--accent);
}

.radial-key-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 88px;
  height: 88px;
  margin: -44px 0 0 -44px;
  border-radius: 50%;
  border: 1px dashed rgba(130, 170, 255, 0.5);
  background: rgba(26, 27, 38, 0.25);
}

.radial-key-item {
  position: absolute;
  left: 0;
  top: 0;
  min-width: 44px;
  min-height: 44px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.92);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.05s ease, background 0.1s ease, border-color 0.1s ease;
}

.radial-key-item.active {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
  box-shadow: 0 0 12px rgba(130, 170, 255, 0.6);
}

.radial-key-item.special {
  background: rgba(26, 27, 38, 0.7);
  border-color: var(--border);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.radial-key-item.special.active {
  background: var(--warning);
  color: var(--bg-primary);
  border-color: var(--warning);
  box-shadow: 0 0 12px rgba(255, 203, 107, 0.5);
}
</style>
