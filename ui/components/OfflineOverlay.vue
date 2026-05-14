<template>
  <Transition name="offline-fade">
    <div v-if="visible" class="offline-overlay">
      <div class="offline-content">
        <div class="offline-spinner" aria-hidden="true"></div>
        <div class="offline-text">Connection lost</div>
        <div class="offline-sub">Waiting for network...</div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
});
</script>
