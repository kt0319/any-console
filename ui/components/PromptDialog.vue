<template>
  <BaseDialog :visible="visible" :z-index="210" initial-focus="none" @dismiss="onCancel">
    <div class="prompt-dialog" role="dialog" aria-modal="true" :aria-label="title || 'Input dialog'">
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
      <div class="dialog-buttons">
        <button class="dialog-btn dialog-btn-cancel" @click="onCancel">{{ cancelLabel }}</button>
        <button class="dialog-btn dialog-btn-ok" :disabled="value.length === 0" @click="onSubmit">{{ confirmLabel }}</button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup>
import { ref, watch, nextTick } from "vue";
import BaseDialog from "./BaseDialog.vue";
import { usePrompt } from "../composables/usePrompt.ts";

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

// 入力ダイアログは端末種別に関わらず入力欄へ直接フォーカスする
watch(visible, async (nextVisible) => {
  if (!nextVisible) return;
  await nextTick();
  inputEl.value?.focus();
  if (selectOnOpen.value) inputEl.value?.select?.();
});
</script>

<style scoped>
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
</style>
