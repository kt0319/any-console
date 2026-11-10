<template>
  <div class="modal-scroll-body dispatch-queue-tab">
    <div v-if="pending.length === 0 && recent.length === 0" class="dispatch-queue-hint">No dispatch requests for this workspace</div>
    <template v-else>
      <template v-if="pending.length">
        <div class="settings-section-label">Pending dispatches</div>
        <ul class="dispatch-queue-list">
          <li v-for="item in pending" :key="item.id" class="dispatch-queue-row">
            <button type="button" class="dispatch-queue-row-main dispatch-queue-pending-row" @click="emits('select', item.id)">
              <DispatchQueueRowBody :request="item.request" />
            </button>
            <button
              type="button"
              class="row-danger-btn"
              aria-label="Discard dispatch"
              data-tooltip="Discard dispatch"
              :disabled="discardingIds.has(item.id)"
              @click="discard(item)"
            >
              <span class="mdi mdi-close"></span>
            </button>
          </li>
        </ul>
      </template>

      <template v-if="recent.length">
        <ul class="dispatch-queue-list">
          <li v-for="item in recent" :key="item.id" class="dispatch-queue-row">
            <button
              type="button"
              class="dispatch-queue-row-main dispatch-queue-recent-row"
              :class="`dispatch-queue-recent-${item.outcome}`"
              @click="emits('select', item.id)"
            >
              <DispatchQueueRowBody :request="item.request" :outcome="item.outcome" :auth="item.auth" :job-label="jobLabel(item.request)" />
            </button>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useDispatchQueue } from "../composables/useDispatchQueue.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { dispatchWorkspaceLabel, dispatchBaseWorkspaceLabel } from "../utils/dispatch-request.ts";
import { baseWorkspaceName } from "../utils/worktree.ts";
import DispatchQueueRowBody from "./DispatchQueueRowBody.vue";

// WorkspaceDetail.vueの「Dispatch」タブの中身。全ワークスペース横断の
// グローバル一覧（Settings配下の独立画面）を廃止し、
// 対応するワークスペースの項目だけに絞ってここへ統合した
// （GitHubActionsPane.vue等、他のGitHub系タブと同じ「ワークスペース詳細内の
// タブ」パターンに揃える）。1件選ぶとDispatchRunViewを表示するが、Settings側
// のpushViewには乗せず、選択IDをWorkspaceDetail.vueへemitしてタブ内で
// ローカルに切り替える（Settings側の別レイヤーとして開いてしまっていたため）。

const workspaceStore = useWorkspaceStore();
const emits = defineEmits(["select"]);
const { queue, recent: allRecent, discardItem, jobLabel } = useDispatchQueue();

const pending = computed(() =>
  queue.value.filter((item) => dispatchWorkspaceLabel(item.request) === workspaceStore.selectedWorkspace),
);
// 確認ダイアログ中・API実行中の二重実行を防ぐ。
const discardingIds = reactive(new Set<string>());
async function discard(item: { id: string, request: Record<string, any> }) {
  if (discardingIds.has(item.id)) return;
  discardingIds.add(item.id);
  try {
    await discardItem(item.id, dispatchWorkspaceLabel(item.request));
  } finally {
    discardingIds.delete(item.id);
  }
}

// 履歴（recent）はworktreeと元のディレクトリで共有する。worktreeで実行した
// dispatchも元のディレクトリの履歴に出したい／worktree側からも元のディレクトリ
// の履歴を見たいため、ベースワークスペース名同士で突き合わせる（pendingは
// 承認操作を伴うため対象を絞ったまま変更しない）。
const recent = computed(() => {
  const base = baseWorkspaceName(workspaceStore.selectedWorkspace);
  return allRecent.value.filter((item) => dispatchBaseWorkspaceLabel(item.request) === base);
});
</script>

<style scoped>
.dispatch-queue-tab {
  padding: 8px 0;
}

.settings-section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 4px 12px 0;
}

.dispatch-queue-hint {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px;
}

.dispatch-queue-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}

.dispatch-queue-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
}

.dispatch-queue-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 44px;
  padding: 10px 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
}

@media (hover: hover) and (pointer: fine) {
  .dispatch-queue-row-main:hover {
    background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  }
}

/* pendingと履歴は文字の明るさだけで区別する（履歴は対応不要なので沈ませる）。 */
.dispatch-queue-recent-row {
  color: var(--text-muted);
}

.dispatch-queue-recent-row :deep(.dispatch-queue-text) {
  color: var(--text-muted);
}
</style>
