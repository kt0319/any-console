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
