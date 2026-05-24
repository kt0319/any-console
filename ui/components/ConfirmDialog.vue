<template>
  <div v-if="visible" class="confirm-overlay" @click.self="onCancel">
    <div
      class="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-describedby="confirm-msg"
    >
      <p id="confirm-msg" class="confirm-message">{{ message }}</p>
      <div v-if="extraButton?.desc" class="confirm-extra-desc">{{ extraButton.desc }}</div>
      <div class="confirm-buttons">
        <button ref="cancelBtn" class="confirm-btn confirm-btn-cancel" @click="onCancel">Cancel</button>
        <button v-if="extraButton" class="confirm-btn confirm-btn-extra" @click="onExtra">
          <span v-if="extraButton.icon" class="mdi" :class="extraButton.icon"></span>{{ extraButton.label }}
        </button>
        <button class="confirm-btn" :class="okButton?.danger ? 'confirm-btn-danger' : 'confirm-btn-ok'" @click="onOk">
          <span v-if="okButton?.icon" class="mdi" :class="okButton.icon"></span>{{ okButton?.label || "OK" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onUnmounted } from "vue";
import { useConfirm } from "../composables/useConfirm.js";
import { isTouchOnly, listenForEscape } from "../utils/keyboard.js";

const { visible, message, extraButton, okButton, onOk, onCancel, onExtra } = useConfirm();
const cancelBtn = ref(null);

let prevFocus = null;
let releaseEscape = null;

watch(visible, (val) => {
  if (val) {
    prevFocus = document.activeElement;
    // タッチデバイスでは自動フォーカスしない（キーボード誤起動を防ぐ）
    if (!isTouchOnly()) {
      nextTick(() => cancelBtn.value?.focus());
    }
    releaseEscape = listenForEscape(onCancel);
  } else {
    releaseEscape?.();
    releaseEscape = null;
    // タッチデバイスでは prevFocus 復元もしない（xterm 等にフォーカス戻すと
    // ソフトキーボードが起動してしまうため）
    if (!isTouchOnly()) {
      nextTick(() => /** @type {HTMLElement|null} */ (prevFocus)?.focus());
    }
    prevFocus = null;
  }
});
onUnmounted(() => releaseEscape?.());
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

.confirm-btn {
  flex: 1;
  min-width: 80px;
  min-height: 44px;
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
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

.confirm-btn-extra {
  background: transparent;
  color: var(--success);
  border-color: var(--success);
}

.confirm-btn-danger {
  background: var(--error);
  color: #fff;
  border-color: var(--error);
}

.confirm-extra-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: -8px 0 0;
}
</style>
