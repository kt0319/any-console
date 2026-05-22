<template>
  <div class="modal-scroll-body">
    <label class="display-row">
      <input type="checkbox" class="form-checkbox" v-model="debugMode" />
      <div class="display-text">
        <div class="display-label">Debug mode</div>
        <div class="display-desc">Show real-time logs (WS / API / events) in the title bar instead of the tab title.</div>
      </div>
    </label>
  </div>
</template>

<script setup>
import { inject, onMounted } from "vue";
import { useDebugMode } from "../composables/useDebugMode.js";

const modalTitle = inject("modalTitle");
const debugMode = useDebugMode();

onMounted(() => { modalTitle.value = "Display"; });
</script>

<style scoped>
.display-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.display-row + .display-row {
  margin-top: 8px;
}

.display-row .form-checkbox {
  margin-top: 2px;
  flex-shrink: 0;
}

.display-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.display-label {
  font-size: 14px;
  color: var(--text-primary);
}

.display-desc {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
