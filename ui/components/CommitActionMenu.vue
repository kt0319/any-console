<template>
  <span class="file-browser-header-actions">
    <button type="button" class="file-browser-header-btn" aria-label="Cherry-pick" data-tooltip="Cherry-pick" @click="$emit('exec', { action: 'cherry-pick' })"><span class="mdi mdi-content-duplicate" aria-hidden="true"></span></button>
    <button type="button" class="file-browser-header-btn" aria-label="Revert" data-tooltip="Revert" @click="$emit('exec', { action: 'revert' })"><span class="mdi mdi-undo" aria-hidden="true"></span></button>
    <button type="button" class="file-browser-header-btn" aria-label="Create branch" data-tooltip="Create branch" @click="$emit('exec', { action: 'branch' })"><span class="mdi mdi-source-branch-plus" aria-hidden="true"></span></button>
    <button
      v-for="b in branches"
      :key="'merge-' + b"
      type="button"
      class="file-browser-header-btn"
      :aria-label="`Merge ${b}`"
      :data-tooltip="`Merge ${b}`"
      @click="$emit('exec', { action: 'merge', branch: b })"
    ><span class="mdi mdi-source-merge" aria-hidden="true"></span></button>
    <button
      v-for="b in branches"
      :key="'rebase-' + b"
      type="button"
      class="file-browser-header-btn"
      :aria-label="`Rebase onto ${b}`"
      :data-tooltip="`Rebase onto ${b}`"
      @click="$emit('exec', { action: 'rebase', branch: b })"
    ><span class="mdi mdi-source-branch-sync" aria-hidden="true"></span></button>
    <button type="button" class="file-browser-header-btn" aria-label="Reset --soft" data-tooltip="Reset --soft" @click="$emit('exec', { action: 'reset', mode: 'soft' })"><span class="mdi mdi-restore" aria-hidden="true"></span></button>
    <button type="button" class="file-browser-header-btn file-browser-header-btn-delete" aria-label="Reset --hard" data-tooltip="Reset --hard" @click="$emit('exec', { action: 'reset', mode: 'hard' })"><span class="mdi mdi-delete-sweep" aria-hidden="true"></span></button>
  </span>
</template>

<script setup>
defineProps({
  branches: { type: Array, default: () => [] },
});

defineEmits(["exec"]);
</script>

<style scoped>
.file-browser-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.file-browser-header-btn {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 16px;
  padding: 4px 8px;
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  min-width: 32px;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-browser-header-btn-delete {
  color: var(--error);
  border-color: var(--error);
}

@media (hover: hover) and (pointer: fine) {
  .file-browser-header-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
}
</style>
