<template>
  <button
    type="button"
    tabindex="-1"
    class="git-action-btn"
    :class="[btnClass, { running }]"
    :title="title"
    @click.stop="$emit('action')"
  >
    <svg v-if="icon === 'pull'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
    <svg v-else-if="icon === 'push'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
    <svg v-else-if="icon === 'push-upstream'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 16 12 10 18 16"/><polyline points="6 10 12 4 18 10"/></svg>
    <svg v-else-if="icon === 'set-upstream'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
    <span v-if="count != null" class="git-action-count">{{ count }}</span>
  </button>
</template>

<script setup>
defineProps({
  icon: { type: String, required: true },
  title: { type: String, default: "" },
  count: { type: Number, default: null },
  running: { type: Boolean, default: false },
  btnClass: { type: [String, Object, Array], default: "" },
});

defineEmits(["action"]);
</script>
