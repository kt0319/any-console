<template>
  <div v-if="visible" class="prompt-overlay" @click.self="onCancel">
    <div ref="dialogEl" class="prompt-dialog" role="dialog" aria-modal="true" :aria-label="title || 'Input dialog'">
      <div v-if="title" class="prompt-title">{{ title }}</div>
      <p v-if="message" class="prompt-message">{{ message }}</p>
      <input
        ref="inputEl"
        v-model="value"
        class="form-input prompt-input"
        :type="inputType"
        :aria-label="title || message || 'Input'"
        :placeholder="placeholder"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @keydown.enter.prevent="onSubmit"
        @keydown.esc.prevent="onCancel"
      />
      <div class="prompt-buttons">
        <button class="prompt-btn prompt-btn-cancel" @click="onCancel">{{ cancelLabel }}</button>
        <button class="prompt-btn prompt-btn-ok" :disabled="value.length === 0" @click="onSubmit">{{ confirmLabel }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onUnmounted } from "vue";
import { usePrompt } from "../composables/usePrompt.js";
import { trapFocusWithin } from "../composables/useModal.js";
import { isTouchOnly, listenForEscape } from "../utils/keyboard.js";

const {
  visible,
  title,
  message,
  value,
  placeholder,
  confirmLabel,
  cancelLabel,
  inputType,
  selectOnOpen,
  onSubmit,
  onCancel,
} = usePrompt();

const inputEl = ref(null);
const dialogEl = ref(null);
let prevFocus = null;
let releaseEscape = null;
let releaseTrap = null;

watch(visible, async (nextVisible) => {
  if (nextVisible) {
    prevFocus = document.activeElement;
    releaseEscape = listenForEscape(onCancel);
    await nextTick();
    if (dialogEl.value) {
      releaseTrap?.();
      releaseTrap = trapFocusWithin(dialogEl.value);
    }
    inputEl.value?.focus();
    if (selectOnOpen.value) inputEl.value?.select?.();
    return;
  }

  releaseTrap?.();
  releaseTrap = null;
  releaseEscape?.();
  releaseEscape = null;
  if (!isTouchOnly()) {
    await nextTick();
    /** @type {HTMLElement|null} */ (prevFocus)?.focus();
  }
  prevFocus = null;
});

onUnmounted(() => {
  releaseTrap?.();
  releaseEscape?.();
});
</script>

<style scoped>
.prompt-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
  padding: 20px;
}

.prompt-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  width: min(420px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.prompt-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.prompt-message {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.prompt-input {
  min-height: 40px;
  font-size: 14px;
}

.prompt-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.prompt-btn {
  min-width: 80px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-size: 14px;
  font-weight: 500;
}

.prompt-btn-cancel {
  background: transparent;
  color: var(--text-secondary);
}

.prompt-btn-ok {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
</style>
