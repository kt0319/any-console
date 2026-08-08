<template>
  <div class="modal-scroll-body dispatch-queue-tab">
    <div v-if="pending.length === 0 && recent.length === 0" class="dispatch-queue-hint">No dispatch requests for this workspace</div>
    <template v-else>
      <template v-if="pending.length">
        <div class="settings-section-label">Pending dispatches</div>
        <ul class="dispatch-queue-list">
          <li v-for="item in pending" :key="item.id" class="dispatch-queue-row">
            <button type="button" class="dispatch-queue-row-main" @click="emits('select', item.id)">
              <DispatchQueueRowBody :request="item.request" />
            </button>
          </li>
        </ul>
      </template>

      <template v-if="recent.length">
        <div class="settings-section-label dispatch-queue-recent-label">Recently executed</div>
        <ul class="dispatch-queue-list">
          <li v-for="item in recent" :key="item.id" class="dispatch-queue-row">
            <button
              type="button"
              class="dispatch-queue-row-main dispatch-queue-recent-row"
              :class="item.decision === 'approved' ? 'dispatch-queue-recent-approved' : 'dispatch-queue-recent-rejected'"
              @click="emits('select', item.id)"
            >
              <DispatchQueueRowBody :request="item.request" :decision="item.decision" />
            </button>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { dispatchWorkspaceLabel } from "../utils/dispatch-request.js";
import DispatchQueueRowBody from "./DispatchQueueRowBody.vue";

// WorkspaceDetail.vueの「Dispatch」タブの中身。旧SessionDispatchesTab.vue
// （全ワークスペース横断のグローバル一覧、Settings配下の独立画面）を廃止し、
// 対応するワークスペースの項目だけに絞ってここへ統合した
// （GitHubActionsPane.vue等、他のGitHub系タブと同じ「ワークスペース詳細内の
// タブ」パターンに揃える）。1件選ぶとDispatchRunViewを表示するが、Settings側
// のpushViewには乗せず、選択IDをWorkspaceDetail.vueへemitしてタブ内で
// ローカルに切り替える（Settings側の別レイヤーとして開いてしまっていたため）。

const workspaceStore = useWorkspaceStore();
const emits = defineEmits(["select"]);
const { queue, recent: allRecent } = useDispatchConfirm();

const pending = computed(() =>
  queue.value.filter((item) => dispatchWorkspaceLabel(item.request) === workspaceStore.selectedWorkspace),
);
const recent = computed(() =>
  allRecent.value.filter((item) => dispatchWorkspaceLabel(item.request) === workspaceStore.selectedWorkspace),
);
</script>

<style scoped>
.dispatch-queue-tab {
  padding: 8px;
}

.settings-section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 4px 4px 0;
}

.dispatch-queue-hint {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px 4px;
}

.dispatch-queue-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dispatch-queue-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.dispatch-queue-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 6px);
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  color: var(--text-primary);
  text-align: left;
}

@media (hover: hover) and (pointer: fine) {
  .dispatch-queue-row-main:hover {
    border-color: var(--accent);
  }
}

.dispatch-queue-recent-label {
  margin-top: 16px;
}

/* 承認/却下が一目で分かるようアイコン+枠線色で示す。 */
.dispatch-queue-recent-approved {
  border-color: color-mix(in srgb, var(--success) 40%, var(--border));
}

.dispatch-queue-recent-rejected {
  opacity: 0.7;
}
</style>
