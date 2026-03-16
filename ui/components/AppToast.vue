<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-container" @after-leave="restack">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        :class="['toast', `toast-${toast.type}`, 'show']"
        :style="{ top: toast.top + 'px' }"
        @click="dismiss(toast)"
      >
        {{ toast.message }}
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup>
import { ref, nextTick } from "vue";

let idCounter = 0;
const toasts = ref([]);

function restack() {
  let offset = 24;
  for (const toast of toasts.value) {
    toast.top = offset;
    offset += 48;
  }
}

function dismiss(toast) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(toast.message).catch(() => {});
  }
  toasts.value = toasts.value.filter((t) => t.id !== toast.id);
  nextTick(restack);
}

function show(message, type = "error") {
  const text = typeof message === "string" ? message : String(message?.message || message || "不明なエラー");
  const id = ++idCounter;
  const toast = { id, message: text, type, top: 24 };
  toasts.value.push(toast);
  nextTick(restack);
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
    nextTick(restack);
  }, 3000);
}

defineExpose({ show });
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10000;
  pointer-events: none;
}
.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  font-size: 13px;
  text-align: center;
  z-index: 10000;
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  max-width: calc(100% - 32px);
  min-width: 200px;
  width: auto;
  cursor: pointer;
  pointer-events: auto;
  transition: top 0.3s, opacity 0.3s;
}
.toast-error {
  background: color-mix(in srgb, var(--error) 85%, transparent);
  color: #fff;
}
.toast-success {
  background: color-mix(in srgb, var(--accent) 85%, transparent);
  color: var(--bg-primary);
}
.toast-info {
  background: color-mix(in srgb, var(--bg-tertiary) 85%, transparent);
  color: var(--text-primary);
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-100%);
}
.toast-enter-active {
  transition: opacity 0.3s, transform 0.3s;
}
.toast-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-100%);
}
</style>
