<template>
  <div class="dialog-copy-field">
    <input
      class="dialog-copy-input"
      type="text"
      readonly
      :value="value"
      :aria-label="label"
      autocomplete="off"
      spellcheck="false"
      @focus="selectAll"
    />
    <button
      type="button"
      class="dialog-copy-btn"
      :aria-label="copied ? 'Copied' : `Copy ${label}`"
      :data-tooltip="copied ? 'Copied!' : `Copy ${label}`"
      @click="copy(value)"
    >
      <span class="mdi" :class="copied ? 'mdi-check' : 'mdi-content-copy'"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";

defineProps<{ value: string, label: string }>();

const { copied, copy } = useCopyFeedback();

function selectAll(e: FocusEvent) {
  (e.target as HTMLInputElement).select();
}
</script>

<style scoped>
.dialog-copy-field {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 0;
}

.dialog-copy-field:focus-within {
  border-color: var(--accent);
}

.dialog-copy-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  text-overflow: ellipsis;
}

.dialog-copy-input:focus {
  outline: none;
}

.dialog-copy-btn {
  flex-shrink: 0;
  width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-left: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}
</style>
