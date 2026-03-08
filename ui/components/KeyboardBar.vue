<template>
  <div
    id="quick-input-panel"
    ref="panelEl"
    :class="['quick-input-panel', { 'minimal-mode': mode === 0, 'extra-open': mode === 1 }]"
  >
    <div v-show="mode === 0" class="quick-minimal-keys">
      <div
        v-for="key in quickKeys"
        :key="key.label"
        class="quick-key"
        @touchstart.prevent="onQuickKeyTouchStart($event, key)"
        @touchend.prevent="onQuickKeyTouchEnd($event, key)"
        @touchcancel="onQuickKeyCancel($event)"
        @mousedown="onQuickKeyMouseDown($event, key)"
        @mouseup="onQuickKeyMouseUp($event, key)"
        @mouseleave="onQuickKeyCancel($event)"
      >{{ key.label }}</div>
    </div>

    <div
      class="quick-key quick-flick-arrow quick-key-toggle"
      :class="{ active: mode === 1 }"
      ref="arrowFlickEl"
    >
      <span class="flick-hint-top">&uarr;</span>
      <span class="flick-hint-left">&larr;</span>
      <span class="flick-main">
        <span v-if="mode === 0" class="mdi mdi-keyboard"></span>
        <span v-else class="mdi mdi-close"></span>
      </span>
      <span class="flick-hint-right">&rarr;</span>
      <span class="flick-hint-bottom">&darr;</span>
    </div>

    <div
      class="quick-key quick-flick-enter quick-flick-arrow quick-key-toggle"
      ref="enterFlickEl"
    >
      <span class="flick-hint-top">Tab</span>
      <span class="flick-hint-left">BS</span>
      <span class="flick-main">&crarr;</span>
      <span class="flick-hint-bottom">Space</span>
      <span class="flick-hint-right">Del</span>
    </div>
  </div>

  <div v-show="mode === 1" class="quick-extra-panel quick-qwerty-panel" ref="qwertyPanelEl">
    <div v-for="(row, ri) in qwertyRows" :key="ri" class="quick-extra-row">
      <div
        v-for="(keyDef, ci) in row"
        :key="ci"
        class="quick-key"
        :class="{ 'quick-flick-arrow': hasFlick(ri, ci, keyDef) }"
        @touchstart.prevent="onQwertyTouchStart($event, keyDef, ri, ci)"
        @touchend.prevent="onQwertyTouchEnd($event, keyDef, ri, ci)"
        @touchcancel="onQuickKeyCancel($event)"
        @mouseup="onQwertyMouseUp($event, keyDef, ri, ci)"
      >
        <template v-if="hasFlick(ri, ci, keyDef)">
          <span v-if="flickUpLabel(ri, ci, keyDef)" class="flick-hint-top">{{ flickUpLabel(ri, ci, keyDef) }}</span>
          <span class="flick-main">{{ displayLabel(keyDef) }}</span>
          <span v-if="keyDef.flickDown" class="flick-hint-bottom">{{ keyDef.flickDown }}</span>
        </template>
        <template v-else>{{ displayLabel(keyDef) }}</template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useInputStore } from "../stores/input.js";

const inputStore = useInputStore();
const { sendKeyToTerminal, modifierState, clearModifiers, setupFlickRepeat, scrollTerminal, getActiveTerminalTab } = useKeyboard();

const panelEl = ref(null);
const arrowFlickEl = ref(null);
const enterFlickEl = ref(null);
const qwertyPanelEl = ref(null);

const mode = ref(0);

const quickKeys = computed(() => inputStore.QUICK_KEYS || []);
const qwertyRows = computed(() => inputStore.QWERTY_ROWS || []);
const numberKeys = computed(() => inputStore.NUMBER_KEYS || []);

function displayLabel(keyDef) {
  if (modifierState.shift && keyDef.key?.length === 1) return keyDef.key.toUpperCase();
  return keyDef.label || keyDef.key;
}

function hasFlick(ri, ci, keyDef) {
  return (ri === 0 && ci < (numberKeys.value?.length || 0)) || !!keyDef.flickUp || !!keyDef.flickDown;
}

function flickUpLabel(ri, ci, keyDef) {
  if (ri === 0 && ci < (numberKeys.value?.length || 0)) return numberKeys.value[ci]?.label;
  return keyDef.flickUp || "";
}

function cycleMode() {
  mode.value = (mode.value + 1) % 2;
  clearModifiers();
}

function onQuickKeyTouchStart(e, keyDef) {
  e.currentTarget.classList.add("pressed");
}

function onQuickKeyTouchEnd(e, keyDef) {
  e.currentTarget.classList.remove("pressed");
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendKeyToTerminal(merged);
}

function onQuickKeyMouseDown(e, keyDef) {
  if (e.button !== 0) return;
  e.currentTarget.classList.add("pressed");
}

function onQuickKeyMouseUp(e, keyDef) {
  if (e.button !== 0) return;
  e.currentTarget.classList.remove("pressed");
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendKeyToTerminal(merged);
}

function onQuickKeyCancel(e) {
  e.currentTarget.classList.remove("pressed");
}

function onQwertyTouchStart(e, keyDef, ri, ci) {
  e.currentTarget.classList.add("pressed");
}

function onQwertyTouchEnd(e, keyDef, ri, ci) {
  e.currentTarget.classList.remove("pressed");
  const dy = e.changedTouches[0].clientY - (e.currentTarget._touchStartY || 0);
  if (hasFlick(ri, ci, keyDef) && dy < -30) {
    const upKey = ri === 0 && ci < numberKeys.value.length
      ? numberKeys.value[ci]
      : { key: keyDef.flickUp, label: keyDef.flickUp };
    if (upKey) sendKeyToTerminal(upKey);
    return;
  }
  if (keyDef.flickDown && dy > 30) {
    sendKeyToTerminal({ key: keyDef.flickDown, label: keyDef.flickDown });
    return;
  }
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendKeyToTerminal(merged);
}

function onQwertyMouseUp(e, keyDef, ri, ci) {
  if (e.button !== 0) return;
  const merged = { ...keyDef };
  if (modifierState.ctrl) merged.ctrl = true;
  if (modifierState.shift) merged.shift = true;
  sendKeyToTerminal(merged);
}

onMounted(() => {
  if (arrowFlickEl.value) {
    setupFlickRepeat(arrowFlickEl.value, (dx, dy, threshold) => {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold)
        return dx < 0 ? { key: "ArrowLeft" } : { key: "ArrowRight" };
      if (Math.abs(dy) > threshold && dy < 0) return { key: "ArrowUp" };
      if (Math.abs(dy) > threshold && dy > 0) return { key: "ArrowDown" };
      return null;
    }, () => {
      if (mode.value === 1) { cycleMode(); return; }
      const tab = getActiveTerminalTab();
      if (tab?.term) tab.term.scrollToBottom();
    }, {
      accelerateRepeat: true,
      onLongPress: () => cycleMode(),
      longPressGuard: () => mode.value === 0,
    });
  }

  if (enterFlickEl.value) {
    setupFlickRepeat(enterFlickEl.value, (dx, dy, threshold) => {
      if (Math.abs(dy) > Math.abs(dx) && dy < -threshold) return { key: "Tab" };
      if (Math.abs(dy) > Math.abs(dx) && dy > threshold) return { key: " " };
      if (Math.abs(dx) > Math.abs(dy) && dx < -threshold) return { key: "Backspace" };
      if (Math.abs(dx) > Math.abs(dy) && dx > threshold) return { key: "Delete" };
      return null;
    }, () => {
      sendKeyToTerminal({ key: "Enter" });
    }, { accelerateRepeat: true });
  }
});

defineExpose({ mode, cycleMode });
</script>
