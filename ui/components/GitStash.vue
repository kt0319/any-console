<template>
  <div class="git-stash-pane-wrapper">
    <div class="modal-scroll-body" ref="stashListEl">
      <div v-if="isStashListLoading" class="text-muted-center">Loading...</div>
      <div v-else-if="stashEntries.length === 0" class="text-muted-center">No stash entries</div>
      <div v-for="entry in stashEntries" :key="entry.ref" class="stash-entry">
        <div class="stash-entry-info">
          <span class="stash-entry-ref">{{ entry.ref }}</span>
          <span class="stash-entry-msg">{{ entry.message }}</span>
          <span v-if="entry.time" class="stash-entry-time">{{ entry.time }}</span>
        </div>
        <div class="stash-entry-actions">
          <button type="button" class="commit-action-item" @click="stashPop(entry)">Pop</button>
          <button type="button" class="commit-action-item commit-action-danger" @click="stashDrop(entry)">Drop</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { confirmIrreversible } from "../utils/confirm-irreversible.ts";
import { useWorkspace } from "../composables/useWorkspace.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { setStashCache, invalidateStashCache } from "../composables/useStashCache.ts";

const emit = defineEmits(["count"]);
const { apiGet, apiCommand, wsEndpoint } = useApi();
const { confirm } = useConfirm();
const { withWorkspace } = useWorkspace();

const stashEntries = ref([]);
const isStashListLoading = ref(false);
const stashListEl = ref(null);

async function loadStashList() {
  await withWorkspace(async (workspace) => {
    isStashListLoading.value = true;
    try {
      const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, "stash-list"));
      if (!ok) return;
      const result = data.entries || [];
      stashEntries.value = result;
      setStashCache(workspace, result);
      emit("count", result.length);
    } catch (e) {
      console.error("stash list load failed:", e);
    } finally {
      isStashListLoading.value = false;
    }
  });
}

async function stashPop(entry) {
  await withWorkspace(async (workspace) => {
    const { ok } = await apiCommand(wsEndpoint(workspace, "stash-pop-ref"), { stash_ref: entry.ref }, { errorMessage: "Stash pop failed" });
    if (!ok) return;
    invalidateStashCache(workspace);
    await loadStashList();
    bridgeEmit("git:commitDone");
  });
}

async function stashDrop(entry) {
  if (!await confirmIrreversible(confirm, `Drop stash ${entry.ref}?`)) return;
  await withWorkspace(async (workspace) => {
    const { ok } = await apiCommand(wsEndpoint(workspace, "stash-drop"), { stash_ref: entry.ref }, { errorMessage: "Stash drop failed" });
    if (!ok) return;
    invalidateStashCache(workspace);
    await loadStashList();
  });
}

defineExpose({ load: loadStashList });
</script>

<style scoped>
.git-stash-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.stash-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.stash-entry:last-child {
  border-bottom: none;
}

.stash-entry-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stash-entry-ref {
  color: var(--warning);
  font-weight: 600;
  font-size: 11px;
}

.stash-entry-msg {
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stash-entry-time {
  color: var(--text-muted);
  font-size: 11px;
}

.stash-entry-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

</style>
