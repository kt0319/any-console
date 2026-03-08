<template>
  <div
    class="terminal-pane"
    :class="{ active: isActive }"
    ref="paneEl"
    @pointerdown="onPointerDown"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
  >
    <div :id="'frame-' + tab.id" class="terminal-frame" ref="frameEl"></div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, computed } from "vue";
import { useTerminal } from "../composables/useTerminal.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const { ensureTerminalOpened, fitTerminal, disconnectTerminal } = useTerminal();

const paneEl = ref(null);
const frameEl = ref(null);
let touchStartY = 0;

const isActive = computed(() => {
  if (layoutStore.splitMode && props.paneIndex >= 0) {
    return layoutStore.activePaneIndex === props.paneIndex;
  }
  return terminalStore.activeTabId === props.tab.id;
});

function onPointerDown(e) {
  if (layoutStore.isTouchDevice) return;
  if (!layoutStore.splitMode) return;
  if (isActive.value) return;
  emits("select-pane", props.paneIndex);
}

function onTouchStart(e) {
  touchStartY = e.touches?.[0]?.clientY || 0;
}

function onTouchEnd(e) {
  const endY = e.changedTouches?.[0]?.clientY || 0;
  if (Math.abs(endY - touchStartY) > 10) return;
  if (!layoutStore.splitMode) return;
  emits("select-pane", props.paneIndex);
}

onMounted(() => {
  if (props.tab._pendingOpen && frameEl.value) {
    ensureTerminalOpened(props.tab, frameEl.value);
  }
});

onBeforeUnmount(() => {
  // cleanup handled by parent
});

defineExpose({
  fit() { fitTerminal(props.tab); },
  getFrameEl() { return frameEl.value; },
});
</script>
