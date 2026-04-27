<template>
  <div v-if="visible" class="confirm-overlay" @click.self="onCancel">
    <div class="confirm-dialog">
      <p class="confirm-message">{{ message }}</p>
      <div class="confirm-buttons">
        <button class="confirm-btn confirm-btn-cancel" @click="onCancel">Cancel</button>
        <button class="confirm-btn confirm-btn-ok" @click="onOk">OK</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useConfirm } from "../composables/useConfirm.js";

const { visible, message, onOk, onCancel } = useConfirm();
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 20px;
}

.confirm-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px 20px 16px;
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.confirm-message {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.confirm-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.confirm-btn {
  min-width: 80px;
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.confirm-btn-cancel {
  background: transparent;
  color: var(--text-secondary);
}

.confirm-btn-ok {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
</style>
