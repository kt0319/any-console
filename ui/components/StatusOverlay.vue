<template>
  <Transition name="status-overlay-fade">
    <div v-if="visible" class="status-overlay">
      <div :class="['status-overlay-pill', `variant-${variant}`]">
        <span class="status-overlay-label">{{ label }}</span>
        <span class="loading-dots" aria-hidden="true"></span>
      </div>
    </div>
  </Transition>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  label: { type: String, required: true },
  variant: {
    type: String,
    default: "error",
    validator: (v) => ["error", "warning", "info"].includes(v),
  },
});
</script>

<style scoped>
.status-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 46;
  pointer-events: none;
}

.status-overlay-pill {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  padding: 10px 18px;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  pointer-events: auto;
}

.status-overlay-pill.variant-error {
  background: color-mix(in srgb, var(--error) 75%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 75%, transparent);
}

.status-overlay-pill.variant-warning {
  background: color-mix(in srgb, var(--warning) 75%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 75%, transparent);
}

.status-overlay-pill.variant-info {
  background: color-mix(in srgb, var(--accent) 75%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 75%, transparent);
}

.status-overlay-fade-enter-active { transition: opacity 0.2s ease; }
.status-overlay-fade-leave-active { transition: opacity 0.3s ease; }
.status-overlay-fade-enter-from,
.status-overlay-fade-leave-to { opacity: 0; }
</style>
