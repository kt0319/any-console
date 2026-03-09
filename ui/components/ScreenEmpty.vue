<template>
  <div class="screen-empty-container">
    <div class="screen-empty-content">
      <div class="screen-empty-actions">
        <button type="button" class="screen-empty-open-btn" @click="$emit('openWorkspace')">
          <span class="mdi mdi-plus"></span> ワークスペースを開く
        </button>
      </div>
      <div class="screen-empty-booting" :class="{ 'is-hidden': !booting }" aria-live="polite">
        <div class="app-boot-spinner" aria-hidden="true"></div>
        <div class="app-boot-text">{{ bootMessage }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  booting: { type: Boolean, default: false },
  bootMessage: { type: String, default: "読み込み中..." },
});
defineEmits(["openWorkspace"]);
</script>

<style scoped>
.screen-empty-container {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 100%;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.screen-empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.screen-empty-booting {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 56px;
}

.screen-empty-booting.is-hidden {
  visibility: hidden;
}

.app-boot-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent);
  animation: screen-empty-spin 0.8s linear infinite;
}

@keyframes screen-empty-spin {
  to { transform: rotate(360deg); }
}

.app-boot-text {
  color: var(--text-muted);
  font-size: 13px;
}

.screen-empty-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}

.screen-empty-open-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 24px;
  font-size: 15px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
</style>
