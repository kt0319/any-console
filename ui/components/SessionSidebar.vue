<template>
  <nav
    v-if="isOpen"
    id="session-sidebar"
    class="session-sidebar"
    aria-label="Sessions"
  >
    <SessionListPanel :panel-bottom="false" />
    <div
      class="sidebar-resize-handle"
      :class="{ resizing }"
      role="separator"
      tabindex="0"
      aria-label="Resize session sidebar"
      data-tooltip="Resize session sidebar"
      aria-orientation="vertical"
      aria-controls="session-sidebar"
      :aria-valuemin="SESSION_SIDEBAR_MIN_WIDTH_PX"
      :aria-valuemax="maxWidth"
      :aria-valuenow="width"
      @pointerdown="startResize"
      @pointermove="resize"
      @pointerup="stopResize"
      @pointercancel="stopResize"
      @lostpointercapture="stopResize"
      @keydown="resizeWithKeyboard"
    />
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import SessionListPanel from "./SessionListPanel.vue";
import { clampSidebarWidth, sidebarMaxWidth } from "../utils/sidebar-width.ts";
import {
  SESSION_SIDEBAR_MIN_WIDTH_PX, SESSION_SIDEBAR_RESIZE_STEP_PX,
} from "../utils/constants.ts";

const layoutStore = useLayoutStore();
const { close } = useSessionListOverlay();
const viewportWidth = ref(window.innerWidth);
const maxWidth = computed(() => sidebarMaxWidth(viewportWidth.value));
const width = computed(() => clampSidebarWidth(layoutStore.sessionSidebarWidth, viewportWidth.value));
const resizing = ref(false);
let drag: { id: number; x: number; width: number; target: HTMLElement } | null = null;

function startResize(event: PointerEvent) {
  if (event.button !== 0 || drag) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  target.focus();
  target.setPointerCapture(event.pointerId);
  drag = { id: event.pointerId, x: event.clientX, width: width.value, target };
  resizing.value = true;
}

function resize(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return;
  layoutStore.sessionSidebarWidth = clampSidebarWidth(
    drag.width + event.clientX - drag.x, viewportWidth.value,
  );
}

function stopResize() {
  const previous = drag;
  drag = null;
  resizing.value = false;
  if (previous?.target.hasPointerCapture(previous.id)) {
    previous.target.releasePointerCapture(previous.id);
  }
}

function resizeWithKeyboard(event: KeyboardEvent) {
  let next: number;
  switch (event.key) {
    case "ArrowLeft": next = width.value - SESSION_SIDEBAR_RESIZE_STEP_PX; break;
    case "ArrowRight": next = width.value + SESSION_SIDEBAR_RESIZE_STEP_PX; break;
    case "Home": next = SESSION_SIDEBAR_MIN_WIDTH_PX; break;
    case "End": next = maxWidth.value; break;
    default: return;
  }
  event.preventDefault();
  layoutStore.sessionSidebarWidth = clampSidebarWidth(next, viewportWidth.value);
}

function updateViewportWidth() {
  viewportWidth.value = window.innerWidth;
  stopResize();
}

// サイドバー用のスペースがあるかどうかは実際の画面幅（isNarrowViewport）で
// 判定する——タブバー位置の設定（isPanelBottom）とは独立（Wide画面でタブを
// Bottomに設定していても、幅があるならこちらを使う。Modal.vue参照）。
const isOpen = computed(() => layoutStore.isSessionSidebarOpen && !layoutStore.isNarrowViewport);

watch(isOpen, () => stopResize());

// Esc で閉じる（モバイルはModal.vue側のuseModalが同様のEscハンドリングを持つ）。
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (!layoutStore.isSessionSidebarOpen) return;
  close();
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", updateViewportWidth);
});

onBeforeUnmount(() => {
  stopResize();
  document.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", updateViewportWidth);
});
</script>

<style scoped>
.session-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 15; /* Modal.vue の .modal-overlay(z-index:20) より下、info-pills(10) より上 */
  width: var(--session-sidebar-width);
  max-width: 85vw;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  /* KeyboardBar.vue（ui/styles/keyboard-bar.css の .keyboard-bar）と同じ背景色に揃える。 */
  background: var(--bg-tertiary);
}
.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 12px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  outline: none;
}
.sidebar-resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
  pointer-events: none;
}
.sidebar-resize-handle:focus-visible::after,
.sidebar-resize-handle.resizing::after {
  background: var(--accent);
  width: 2px;
}
@media (hover: hover) and (pointer: fine) {
  .sidebar-resize-handle:hover::after {
    background: var(--accent);
  }
}
</style>
