<template>
  <div class="split-drop-overlay">
    <div class="split-drop-zone drop-top-left" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'top-left')">
      <span class="drop-zone-grid-icon" aria-hidden="true">
        <span class="cell tl"></span>
        <span class="cell tr"></span>
        <span class="cell bl"></span>
        <span class="cell br"></span>
      </span>
    </div>
    <div class="split-drop-zone drop-top-right" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'top-right')">
      <span class="drop-zone-grid-icon" aria-hidden="true">
        <span class="cell tl"></span>
        <span class="cell tr"></span>
        <span class="cell bl"></span>
        <span class="cell br"></span>
      </span>
    </div>
    <div class="split-drop-zone drop-bottom-left" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'bottom-left')">
      <span class="drop-zone-grid-icon" aria-hidden="true">
        <span class="cell tl"></span>
        <span class="cell tr"></span>
        <span class="cell bl"></span>
        <span class="cell br"></span>
      </span>
    </div>
    <div class="split-drop-zone drop-bottom-right" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'bottom-right')">
      <span class="drop-zone-grid-icon" aria-hidden="true">
        <span class="cell tl"></span>
        <span class="cell tr"></span>
        <span class="cell bl"></span>
        <span class="cell br"></span>
      </span>
    </div>
    <template v-if="!isPanelBottom">
      <div class="split-drop-zone drop-left" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'left')">
        <span class="drop-zone-rect-icon rect-left" aria-hidden="true">
          <span class="rect r1"></span>
          <span class="rect r2"></span>
        </span>
      </div>
      <div class="split-drop-zone drop-right" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'right')">
        <span class="drop-zone-rect-icon rect-right" aria-hidden="true">
          <span class="rect r1"></span>
          <span class="rect r2"></span>
        </span>
      </div>
    </template>
    <div class="split-drop-zone drop-top" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'top')">
      <span class="drop-zone-rect-icon rect-top" aria-hidden="true">
        <span class="rect r1"></span>
        <span class="rect r2"></span>
      </span>
    </div>
    <div class="split-drop-zone drop-bottom" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'bottom')">
      <span class="drop-zone-rect-icon rect-bottom" aria-hidden="true">
        <span class="rect r1"></span>
        <span class="rect r2"></span>
      </span>
    </div>
    <div v-if="isSplitMode" class="split-drop-zone drop-center" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'center')">
      <span class="mdi mdi-fullscreen drop-zone-icon"></span>
      <span class="drop-zone-label">Exit split mode</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalDrop } from "../composables/useTerminalDrop.js";

const layoutStore = useLayoutStore();

const isSplitMode = computed(() => layoutStore.isSplitMode);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);

const { onDragEnter, onDragLeave, onDrop } = useTerminalDrop();
</script>

<style scoped>
.split-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}

.split-drop-zone {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  background: rgba(130, 170, 255, 0.18);
  border: 2px dashed rgba(130, 170, 255, 0.45);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.split-drop-zone.drop-left,
.split-drop-zone.drop-right {
  top: 0;
  bottom: 0;
  width: 25%;
}

.split-drop-zone.drop-top-left,
.split-drop-zone.drop-top-right,
.split-drop-zone.drop-bottom-left,
.split-drop-zone.drop-bottom-right {
  width: 18%;
  height: 18%;
  z-index: 1;
}

.split-drop-zone.drop-top-left { top: 0; left: 0; }
.split-drop-zone.drop-top-right { top: 0; right: 0; }
.split-drop-zone.drop-bottom-left { bottom: 0; left: 0; }
.split-drop-zone.drop-bottom-right { right: 0; bottom: 0; }

.split-drop-zone.drop-left {
  left: 0;
  border-right-style: dashed;
  border-left: none;
  border-top: none;
  border-bottom: none;
}

.split-drop-zone.drop-right {
  right: 0;
  border-left-style: dashed;
  border-right: none;
  border-top: none;
  border-bottom: none;
}

.split-drop-zone.drop-top,
.split-drop-zone.drop-bottom {
  left: 25%;
  right: 25%;
  height: 25%;
}

.split-drop-zone.drop-top {
  top: 0;
  border-bottom-style: dashed;
  border-top: none;
  border-left: none;
  border-right: none;
}

.split-drop-zone.drop-bottom {
  bottom: 0;
  border-top-style: dashed;
  border-bottom: none;
  border-left: none;
  border-right: none;
}

.split-drop-zone.drop-center {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 140px;
  height: 64px;
  right: auto;
  bottom: auto;
  flex-direction: column;
  gap: 4px;
  border-radius: 8px;
  background: rgba(130, 170, 255, 0.18);
  border: 2px dashed rgba(130, 170, 255, 0.45);
}

.split-drop-zone.drop-center .drop-zone-icon {
  color: rgba(130, 170, 255, 0.5);
}

.split-drop-zone.drop-center .drop-zone-label {
  font-size: 11px;
  color: rgba(130, 170, 255, 0.7);
  letter-spacing: 0.3px;
  text-transform: none;
  white-space: nowrap;
  transition: color 0.15s ease;
}

.split-drop-zone.drag-over.drop-center {
  background: rgba(130, 170, 255, 0.32);
  border-color: var(--accent);
}

.split-drop-zone.drag-over.drop-center .drop-zone-icon,
.split-drop-zone.drag-over.drop-center .drop-zone-label {
  color: var(--accent);
}

.split-drop-zone.drag-over {
  background: rgba(130, 170, 255, 0.32);
  border-color: var(--accent);
}

.split-drop-zone .drop-zone-icon {
  font-size: 24px;
  color: rgba(130, 170, 255, 0.4);
  transition: color 0.15s ease;
}

.split-drop-zone.drag-over .drop-zone-icon {
  color: var(--accent);
}

.drop-zone-grid-icon {
  display: grid;
  grid-template-columns: repeat(2, 9px);
  grid-template-rows: repeat(2, 9px);
  gap: 3px;
}

.drop-zone-grid-icon .cell {
  width: 9px;
  height: 9px;
  border: 1px solid rgba(130, 170, 255, 0.6);
  background: transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.split-drop-zone.drop-top-left .drop-zone-grid-icon .cell.tl,
.split-drop-zone.drop-top-right .drop-zone-grid-icon .cell.tr,
.split-drop-zone.drop-bottom-left .drop-zone-grid-icon .cell.bl,
.split-drop-zone.drop-bottom-right .drop-zone-grid-icon .cell.br {
  background: rgba(130, 170, 255, 0.45);
}

.split-drop-zone.drag-over .drop-zone-grid-icon .cell {
  border-color: var(--accent);
}

.split-drop-zone.drag-over.drop-top-left .drop-zone-grid-icon .cell.tl,
.split-drop-zone.drag-over.drop-top-right .drop-zone-grid-icon .cell.tr,
.split-drop-zone.drag-over.drop-bottom-left .drop-zone-grid-icon .cell.bl,
.split-drop-zone.drag-over.drop-bottom-right .drop-zone-grid-icon .cell.br {
  background: var(--accent);
}

.drop-zone-rect-icon {
  position: relative;
  display: block;
  width: 26px;
  height: 20px;
}

.drop-zone-rect-icon .rect {
  position: absolute;
  border: 1px solid rgba(130, 170, 255, 0.6);
  border-radius: 2px;
  background: transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.split-drop-zone.drag-over .drop-zone-rect-icon .rect {
  border-color: var(--accent);
}

.rect-left .r1,
.rect-right .r1 {
  top: 2px;
  width: 10px;
  height: 16px;
  background: rgba(130, 170, 255, 0.45);
}

.rect-left .r1 { left: 2px; }
.rect-right .r1 { right: 2px; }

.rect-left .r2,
.rect-right .r2 {
  top: 2px;
  width: 10px;
  height: 16px;
}

.rect-left .r2 { right: 2px; }
.rect-right .r2 { left: 2px; }

.rect-top .r1,
.rect-bottom .r1 {
  left: 2px;
  width: 22px;
  height: 7px;
  background: rgba(130, 170, 255, 0.45);
}

.rect-top .r1 { top: 2px; }
.rect-bottom .r1 { bottom: 2px; }

.rect-top .r2,
.rect-bottom .r2 {
  left: 2px;
  width: 22px;
  height: 7px;
}

.rect-top .r2 { bottom: 2px; }
.rect-bottom .r2 { top: 2px; }

.rect-center .r1 {
  left: 4px;
  top: 5px;
  width: 18px;
  height: 10px;
  background: rgba(130, 170, 255, 0.3);
}

.split-drop-zone.drag-over .rect-left .r1,
.split-drop-zone.drag-over .rect-right .r1,
.split-drop-zone.drag-over .rect-top .r1,
.split-drop-zone.drag-over .rect-bottom .r1,
.split-drop-zone.drag-over .rect-center .r1 {
  background: var(--accent);
}

@media (max-width: 768px) {
  .split-drop-zone.drop-top-left,
  .split-drop-zone.drop-top-right,
  .split-drop-zone.drop-bottom-left,
  .split-drop-zone.drop-bottom-right {
    display: none;
  }

  .split-drop-zone.drop-top,
  .split-drop-zone.drop-bottom {
    left: 0;
    right: 0;
    height: 30%;
  }

  .split-drop-zone.drop-center {
    left: 50%;
    right: auto;
    top: 50%;
    bottom: auto;
    width: 140px;
    height: 64px;
    transform: translate(-50%, -50%);
  }
}
</style>
