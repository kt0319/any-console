<template>
  <li
    class="file-browser-action-menu"
    @mouseenter="$emit('menu-enter')"
    @mouseleave="$emit('menu-leave')"
  >
    <template v-for="action in actions" :key="action.label">
      <button
        v-if="action.show !== false"
        type="button"
        :class="action.danger ? 'file-browser-action-delete' : ''"
        @click="action.handler"
      >
        <span :class="'mdi ' + action.icon"></span> {{ action.label }}
      </button>
    </template>
  </li>
</template>

<script setup>
defineProps({
  actions: { type: Array, required: true },
});
defineEmits(["menu-enter", "menu-leave"]);
</script>
