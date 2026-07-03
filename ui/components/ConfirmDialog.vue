<template>
  <BaseDialog :visible="visible" @dismiss="onCancel">
    <div
      class="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-describedby="confirm-msg"
    >
      <p id="confirm-msg" class="confirm-message">{{ message }}</p>
      <div v-if="extraButton?.desc || extra2Button?.desc" class="confirm-extra-desc">
        <div v-if="extraButton?.desc">{{ extraButton.desc }}</div>
        <div v-if="extra2Button?.desc">{{ extra2Button.desc }}</div>
      </div>
      <div class="confirm-buttons">
        <button class="dialog-btn dialog-btn-cancel" @click="onCancel">Cancel</button>
        <button v-if="extraButton" class="dialog-btn confirm-btn-extra" @click="onExtra">
          <span v-if="extraButton.icon" class="mdi" :class="extraButton.icon"></span>{{ extraButton.label }}
        </button>
        <button v-if="extra2Button" class="dialog-btn confirm-btn-extra2" @click="onExtra2">
          <span v-if="extra2Button.icon" class="mdi" :class="extra2Button.icon"></span>{{ extra2Button.label }}
        </button>
        <button class="dialog-btn" :class="okButton?.danger ? 'dialog-btn-danger' : 'dialog-btn-ok'" @click="onOk">
          <span v-if="okButton?.icon" class="mdi" :class="okButton.icon"></span>{{ okButton?.label || "OK" }}
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup>
import BaseDialog from "./BaseDialog.vue";
import { useConfirm } from "../composables/useConfirm.js";

const { visible, message, extraButton, extra2Button, okButton, onOk, onCancel, onExtra, onExtra2 } = useConfirm();
</script>

<style scoped>
.confirm-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px 20px 16px;
  width: fit-content;
  min-width: 280px;
  max-width: calc(100vw - 40px);
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

.confirm-buttons .dialog-btn {
  flex: 1;
}

.confirm-btn-extra {
  background: transparent;
  color: var(--success);
  border-color: var(--success);
}

.confirm-btn-extra2 {
  background: transparent;
  color: #fde047;
  border-color: #fde047;
}

.confirm-extra-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: -8px 0 0;
}
</style>
