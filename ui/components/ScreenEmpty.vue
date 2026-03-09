<template>
  <div class="empty-tab-placeholder">
    <div class="screen-empty-content">
      <div class="screen-empty-booting" :class="{ 'is-hidden': !booting }" aria-live="polite">
        <div class="app-boot-spinner" aria-hidden="true"></div>
        <div class="app-boot-text">{{ bootMessage }}</div>
      </div>
      <div class="empty-tab-actions">
        <button type="button" class="empty-tab-open-btn" @click="$emit('openWorkspace')">
          <span class="mdi mdi-plus"></span> ワークスペースを開く
        </button>
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
</style>
