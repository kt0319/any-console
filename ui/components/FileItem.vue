<template>
  <li
    class="file-browser-item hover-bg"
    :class="{ selected, gitignored }"
    :data-type="dataType || null"
    @click="$emit('click', $event)"
  >
    <span class="file-browser-item-icon nf-icon" v-html="iconHtml"></span>
    <span class="file-browser-item-name text-ellipsis-flex">{{ label }}</span>
    <span v-if="mtimeText || sizeText" class="file-browser-item-size">{{ sizeText }}</span>
    <span v-if="mtimeText || sizeText" class="file-browser-item-mtime">{{ mtimeText }}</span>
    <slot name="right"></slot>
  </li>
</template>

<script setup lang="ts">
defineProps({
  label: { type: String, required: true },
  iconHtml: { type: String, default: "" },
  dataType: { type: String, default: "" },
  sizeText: { type: String, default: "" },
  mtimeText: { type: String, default: "" },
  selected: { type: Boolean, default: false },
  gitignored: { type: Boolean, default: false },
});

defineEmits(["click"]);
</script>

<style scoped>
.file-browser-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
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


.file-browser-item.gitignored {
  opacity: 0.4;
}

.file-browser-item-mtime,
.file-browser-item-size {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.file-browser-item-mtime {
  min-width: 5.5em;
}

.file-browser-item-size {
  min-width: 5em;
}
</style>
