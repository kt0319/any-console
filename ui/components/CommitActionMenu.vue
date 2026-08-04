<template>
  <span class="file-browser-header-actions">
    <button type="button" class="file-browser-header-btn" aria-label="Show Detail" data-tooltip="Show Detail" @click="$emit('show-detail')"><span class="mdi mdi-information-outline" aria-hidden="true"></span> Show Detail</button>
    <button type="button" class="file-browser-header-btn" aria-label="Cherry-pick" data-tooltip="Cherry-pick" @click="$emit('exec', { action: 'cherry-pick' })"><span class="mdi mdi-content-duplicate" aria-hidden="true"></span> Cherry-pick</button>
    <button type="button" class="file-browser-header-btn" aria-label="Revert" data-tooltip="Revert" @click="$emit('exec', { action: 'revert' })"><span class="mdi mdi-undo" aria-hidden="true"></span> Revert</button>
    <button type="button" class="file-browser-header-btn" aria-label="Create branch" data-tooltip="Create branch" @click="$emit('exec', { action: 'branch' })"><span class="mdi mdi-source-branch-plus" aria-hidden="true"></span> Branch</button>
    <button
      v-for="b in branches"
      :key="'merge-' + b"
      type="button"
      class="file-browser-header-btn"
      :aria-label="`Merge ${b}`"
      :data-tooltip="`Merge ${b}`"
      @click="$emit('exec', { action: 'merge', branch: b })"
    ><span class="mdi mdi-source-merge" aria-hidden="true"></span> Merge {{ b }}</button>
    <button
      v-for="b in branches"
      :key="'rebase-' + b"
      type="button"
      class="file-browser-header-btn"
      :aria-label="`Rebase onto ${b}`"
      :data-tooltip="`Rebase onto ${b}`"
      @click="$emit('exec', { action: 'rebase', branch: b })"
    ><span class="mdi mdi-source-branch-sync" aria-hidden="true"></span> Rebase onto {{ b }}</button>
    <button type="button" class="file-browser-header-btn" aria-label="Reset --soft" data-tooltip="Reset --soft" @click="$emit('exec', { action: 'reset', mode: 'soft' })"><span class="mdi mdi-restore" aria-hidden="true"></span> Reset --soft</button>
    <button type="button" class="file-browser-header-btn file-browser-header-btn-delete" aria-label="Reset --hard" data-tooltip="Reset --hard" @click="$emit('exec', { action: 'reset', mode: 'hard' })"><span class="mdi mdi-delete-sweep" aria-hidden="true"></span> Reset --hard</button>
  </span>
</template>

<script setup>
defineProps({
  branches: { type: Array, default: () => [] },
});

defineEmits(["exec", "show-detail"]);
</script>

<style scoped>
.file-browser-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

@media (max-width: 767px) {
  .file-browser-header-actions {
    flex-basis: 100%;
    justify-content: flex-end;
    margin-top: 4px;
  }
}

.file-browser-header-btn {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.file-browser-header-btn .mdi {
  font-size: 16px;
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
