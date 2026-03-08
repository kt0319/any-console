<template>
  <button
    class="tab-btn"
    :class="{ active: isActive, 'tab-activity': tab._activity, orphan: isOrphan }"
    @click="onClick"
  >
    <span v-if="wsIconHtml" v-html="wsIconHtml"></span>
    <span v-if="iconHtml" v-html="iconHtml"></span>
    <template v-if="!panelBottom">
      {{ label }}
      <span class="tab-close" @click.stop="onClose">&times;</span>
    </template>
  </button>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  tab: { type: Object, required: true },
  activeTabId: { type: String, default: null },
  panelBottom: { type: Boolean, default: false },
  isOrphan: { type: Boolean, default: false },
});

const emits = defineEmits(["select", "close"]);

const isActive = computed(() => props.activeTabId === props.tab.id);

const label = computed(() => {
  if (props.isOrphan) return props.tab.workspace || "terminal";
  return props.tab.workspace || props.tab.label || "";
});

const wsIconHtml = computed(() => {
  if (props.tab.wsIcon) return renderIconStr(props.tab.wsIcon.name, props.tab.wsIcon.color, 14);
  return "";
});

const iconHtml = computed(() => {
  if (props.tab.icon) return renderIconStr(props.tab.icon.name, props.tab.icon.color, 14);
  return "";
});

function renderIconStr(icon, color, size) {
  if (!icon) return "";
  if (icon.startsWith("data:image/") || icon.startsWith("icon:")) {
    const src = icon.startsWith("icon:") ? `/icons/${icon.slice(5)}` : icon;
    return `<img src="${src}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  if (icon.startsWith("favicon:")) {
    const domain = icon.slice("favicon:".length);
    return `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  const styles = [`font-size:${size}px`];
  if (color && /^#[0-9a-fA-F]{3,6}$/.test(color)) styles.push(`color:${color}`);
  return `<span class="mdi ${icon}" style="${styles.join(";")}"></span>`;
}

function onClick() {
  emits("select", props.tab);
}

function onClose() {
  emits("close", props.tab);
}
</script>
