<template>
  <Transition name="offline-fade">
    <div v-if="visible" class="offline-overlay">
      <div class="offline-content">
        <div class="offline-text">
          <span class="offline-label">Connection lost</span>
          <span class="offline-dots" aria-hidden="true"></span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
});
</script>

<style scoped>
.offline-text {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
}

.offline-dots {
  display: inline-block;
  width: 1.2em;
  text-align: left;
  white-space: pre;
  font-variant-numeric: tabular-nums;
}

.offline-dots::after {
  content: "";
  animation: offline-dots 1.2s steps(4) infinite;
}

@keyframes offline-dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}
</style>
