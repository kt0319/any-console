<template>
  <div class="tab-pills">
    <button
      v-for="tab in panes"
      :key="tab.key"
      type="button"
      :class="['tab-pill', { active: activeKey === tab.key }]"
      @click="emit('select', tab.key)"
    >{{ tab.label }}</button>
  </div>
</template>

<script setup>
defineProps({
  panes: { type: Array, required: true },
  activeKey: { type: String, required: true },
});
const emit = defineEmits(["select"]);
</script>

<style scoped>
.tab-pills {
  display: flex;
  justify-content: flex-end;
  padding: 0 8px 8px;
  flex-shrink: 0;
}

.tab-pill {
  font-size: 12px;
  padding: 4px 12px;
  min-height: 28px;
  min-width: unset;
}

.tab-pill.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
  font-weight: 600;
}
</style>
