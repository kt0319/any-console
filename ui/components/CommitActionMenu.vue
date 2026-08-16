<template>
  <span class="file-browser-header-actions">
    <button type="button" class="file-browser-header-btn" aria-label="Copy hash" data-tooltip="Copy hash" @click="$emit('copy-hash')"><span class="mdi mdi-content-copy" aria-hidden="true"></span> Copy hash</button>
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
    ><span class="mdi mdi-source-merge" aria-hidden="true"></span> Merge <span class="file-browser-header-btn-branch">{{ b }}</span></button>
    <button
      v-for="b in branches"
      :key="'rebase-' + b"
      type="button"
      class="file-browser-header-btn"
      :aria-label="`Rebase onto ${b}`"
      :data-tooltip="`Rebase onto ${b}`"
      @click="$emit('exec', { action: 'rebase', branch: b })"
    ><span class="mdi mdi-source-branch-sync" aria-hidden="true"></span> Rebase onto <span class="file-browser-header-btn-branch">{{ b }}</span></button>
    <button type="button" class="file-browser-header-btn" aria-label="Reset" data-tooltip="Reset to this commit" @click="$emit('exec', { action: 'reset' })"><span class="mdi mdi-restore" aria-hidden="true"></span> Reset</button>
  </span>
</template>

<script setup lang="ts">
import type { PropType } from "vue";

defineProps({
  branches: { type: Array as PropType<string[]>, default: () => [] },
});

defineEmits(["exec", "copy-hash"]);
</script>

<style scoped>
.file-browser-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
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

/* origin/feature/xxx のような長いブランチ名でボタンが間延びしないよう、
   ブランチ名部分だけ省略表示する（全体はaria-label/data-tooltipで確認可）。 */
.file-browser-header-btn-branch {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: bottom;
}

@media (hover: hover) and (pointer: fine) {
  .file-browser-header-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
}
</style>
