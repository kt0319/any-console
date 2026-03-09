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
