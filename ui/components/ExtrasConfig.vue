<template>
  <div class="modal-scroll-body">
    <label class="extras-row">
      <input type="checkbox" class="form-checkbox" v-model="debugMode" />
      <div class="extras-text">
        <div class="extras-label">Debug mode</div>
        <div class="extras-desc">Enable verbose logging and extra diagnostic info.</div>
      </div>
    </label>
  </div>
</template>

<script setup>
import { inject, onMounted } from "vue";
import { useDebugMode } from "../composables/useDebugMode.js";

const modalTitle = inject("modalTitle");
const debugMode = useDebugMode();

onMounted(() => { modalTitle.value = "Extras"; });
</script>

<style scoped>
.extras-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.extras-row + .extras-row {
  margin-top: 8px;
}

.extras-row .form-checkbox {
  margin-top: 2px;
  flex-shrink: 0;
}

.extras-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.extras-label {
  font-size: 14px;
  color: var(--text-primary);
}

.extras-desc {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
