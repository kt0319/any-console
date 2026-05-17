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
        <div v-for="(line, i) in toast.lines" :key="i" class="toast-line">{{ line }}</div>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { TOAST_DEFAULT_DURATION_MS } from "../utils/constants.js";

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

function show(message, type = "error", duration = TOAST_DEFAULT_DURATION_MS) {
  const text = typeof message === "string" ? message : String(message?.message || message || "Unknown error");
  const id = ++idCounter;
  const toast = { id, message: text, lines: text.split("\n"), type, top: 24 };
  toasts.value.push(toast);
  nextTick(restack);
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
    nextTick(restack);
  }, duration);
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
.toast-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

@media (max-width: 767px) {
  .toast {
    padding: 8px 12px;
    max-width: calc(100% - 16px);
    min-width: 0;
    font-size: 12px;
  }
}
</style>
