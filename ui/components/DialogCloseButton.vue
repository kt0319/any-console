<template>
  <button
    type="button"
    class="dialog-close-btn"
    aria-label="Cancel"
    data-tooltip="Cancel"
    :disabled="disabled"
    @click="emit('close')"
  ><span class="mdi mdi-close"></span></button>
</template>

<script setup lang="ts">
// ダイアログ（.dialog-box / .confirm-dialog、いずれも position: relative）の右上に置く閉じるボタン。
defineProps({
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits<{ close: [] }>();
</script>

<style scoped>
.dialog-close-btn {
  position: absolute;
  top: 8px;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .dialog-close-btn:hover:not(:disabled) {
    color: var(--text-primary);
  }
}
</style>
