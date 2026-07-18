<template>
  <div
    v-if="state.visible"
    class="circle-keypad"
    :style="{ left: `${state.originX}px`, top: `${state.originY}px` }"
  >
    <div class="circle-keypad-ring"></div>
    <div
      v-for="k in keys"
      :key="k.id"
      class="circle-keypad-item"
      :class="{ active: state.activeId === k.id }"
      :style="itemStyle(k)"
    >{{ k.label }}</div>
    <template v-for="b in specials" :key="b.id">
      <div
        v-if="b.action"
        class="circle-keypad-item special"
        :class="{ active: state.activeId === b.id }"
        :style="specialStyle(b)"
      >{{ b.label }}</div>
    </template>
  </div>
</template>

<script setup>
import { SPECIAL_BUTTON_SIZE } from "../composables/useCircleKeyPad.js";

defineProps({
  state: { type: Object, required: true },
  keys: { type: Array, required: true },
  specials: { type: Array, required: true },
});

const RING_RADIUS = 44;
const RADIUS = RING_RADIUS + 44;

function itemStyle(k) {
  const rad = k.angle * (Math.PI / 180);
  const x = Math.cos(rad) * RADIUS;
  const y = Math.sin(rad) * RADIUS;
  return { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` };
}

function specialStyle(b) {
  return {
    minWidth: `${SPECIAL_BUTTON_SIZE.width}px`,
    minHeight: `${SPECIAL_BUTTON_SIZE.height}px`,
    transform: `translate(calc(-50% + ${b.offsetX}px), calc(-50% + ${b.offsetY}px))`,
  };
}
</script>

<style scoped>
.circle-keypad {
  position: fixed;
  z-index: 200;
  width: 0;
  height: 0;
  pointer-events: none;
}

.circle-keypad::before {
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

.circle-keypad-ring {
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

.circle-keypad-item {
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

.circle-keypad-item.active {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
  box-shadow: 0 0 12px rgba(130, 170, 255, 0.6);
}

.circle-keypad-item.special {
  background: rgba(26, 27, 38, 0.7);
  border-color: var(--border);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.circle-keypad-item.special.active {
  background: var(--warning);
  color: var(--bg-primary);
  border-color: var(--warning);
  box-shadow: 0 0 12px rgba(255, 203, 107, 0.5);
}
</style>
