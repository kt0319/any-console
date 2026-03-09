<template>
  <div class="empty-tab-placeholder">
    <div class="empty-tab-actions">
      <button type="button" class="empty-tab-open-btn" @click="$emit('openWorkspace')">
        <span class="mdi mdi-plus"></span> ワークスペースを開く
      </button>
    </div>
  </div>
</template>

<script setup>
defineEmits(["openWorkspace"]);
</script>
