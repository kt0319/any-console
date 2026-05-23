<template>
  <div class="modal-scroll-body">
    <label class="display-settings-item display-settings-toggle">
      <div class="display-settings-toggle-copy">
        <span class="display-settings-item-label">Debug mode</span>
        <span class="display-settings-note">Show real-time logs (WS / API / events) in the title bar instead of the tab title.</span>
      </div>
      <input type="checkbox" v-model="debugMode" />
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
.display-settings-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--border);
  background: transparent;
}

.display-settings-item:last-of-type {
  border-bottom: none;
}

.display-settings-item-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.display-settings-toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
}

.display-settings-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.display-settings-toggle input[type="checkbox"] {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
}

.display-settings-note {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
