<template>
  <div class="modal-scroll-body">
    <div class="settings-section-label">Pending dispatches</div>
    <div v-if="queue.length === 0" class="dispatch-queue-hint">No pending dispatches</div>
    <ul v-else class="dispatch-queue-list">
      <li
        v-for="item in queue"
        :key="item.id"
        class="dispatch-queue-row"
        :class="{ highlighted: item.id === highlightId }"
      >
        <button type="button" class="dispatch-queue-row-main" @click="pushView('DispatchRunView', { itemId: item.id })">
          <span class="dispatch-queue-ws">{{ item.request.effective_workspace || item.request.workspace }}</span>
          <span class="dispatch-queue-meta">
            <span v-if="item.request.job && item.request.job !== 'terminal'">{{ item.request.job }}</span>
            <span v-if="item.request.branch">{{ item.request.branch }}</span>
          </span>
          <span v-if="item.request.text" class="dispatch-queue-text">{{ item.request.text }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Dispatch Queue";

const viewState = inject("viewState");
const pushView = inject("pushView");
// 通知タップ経由で開いた場合、どのdispatchが通知の元かを示すためのハイライト対象。
// 画面遷移は自動で行わず、一覧内でハイライトするだけに留める。
const highlightId = viewState?.value?.dispatchId ?? null;

const { queue } = useDispatchConfirm();
</script>

<style scoped>
.settings-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
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

.dispatch-queue-row.highlighted .dispatch-queue-row-main {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-tertiary, rgba(255, 255, 255, 0.04)));
}

.dispatch-queue-ws {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dispatch-queue-meta {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.dispatch-queue-text {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (hover: hover) and (pointer: fine) {
  .dispatch-queue-row-main:hover {
    border-color: var(--accent);
  }
}
</style>
