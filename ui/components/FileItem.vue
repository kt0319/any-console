<template>
  <li
    class="file-browser-item"
    :class="{
      selected,
      gitignored,
      'action-open': actionOpen,
      'long-press-surface': longPressSurface,
    }"
    :data-type="dataType || null"
    @click="$emit('click', $event)"
    @contextmenu.prevent="$emit('contextmenu', $event)"
    @mousedown="$emit('mousedown', $event)"
    @mouseup="$emit('mouseup', $event)"
    @mouseleave="$emit('mouseleave', $event)"
    @touchstart.passive="$emit('touchstart', $event)"
    @touchend="$emit('touchend', $event)"
    @touchcancel="$emit('touchcancel', $event)"
  >
    <span class="file-browser-item-icon nf-icon" v-html="iconHtml"></span>
    <span class="file-browser-item-name">{{ label }}</span>
    <span v-if="sizeText" class="file-browser-item-size">{{ sizeText }}</span>
    <slot name="right"></slot>
  </li>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  iconHtml: { type: String, default: "" },
  dataType: { type: String, default: "" },
  sizeText: { type: String, default: "" },
  selected: { type: Boolean, default: false },
  gitignored: { type: Boolean, default: false },
  actionOpen: { type: Boolean, default: false },
  longPressSurface: { type: Boolean, default: false },
});

defineEmits([
  "click",
  "contextmenu",
  "mousedown",
  "mouseup",
  "mouseleave",
  "touchstart",
  "touchend",
  "touchcancel",
]);
</script>

<style scoped>
.file-browser-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  position: relative;
}

.file-browser-item[data-type="dir"] {
  cursor: pointer;
}

.file-browser-item[data-type="file"] {
  cursor: pointer;
}

.file-browser-item-icon {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.file-browser-item-icon.nf-icon {
  font-family: "Hack Nerd Font", monospace;
  font-size: 16px;
  line-height: 1;
}

.file-browser-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-browser-item.gitignored {
  opacity: 0.4;
}

.file-browser-item-size {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.file-browser-item.action-open {
  background: rgba(130, 170, 255, 0.08);
}
</style>
