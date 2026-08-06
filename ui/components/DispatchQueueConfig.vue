<template>
  <div class="modal-scroll-body">
    <p class="dispatch-queue-desc">
      Requests sent via the /dispatch API (CI, automation, external tools) wait here for approval before running in a workspace.
    </p>
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
          <DispatchQueueRowBody :request="item.request" />
        </button>
      </li>
    </ul>

    <template v-if="recent.length">
      <div class="settings-section-label dispatch-queue-recent-label">Recently executed</div>
      <ul class="dispatch-queue-list">
        <li v-for="item in recent" :key="item.id" class="dispatch-queue-row">
          <button
            type="button"
            class="dispatch-queue-row-main dispatch-queue-recent-row"
            :class="item.decision === 'approved' ? 'dispatch-queue-recent-approved' : 'dispatch-queue-recent-rejected'"
            @click="pushView('DispatchRunView', { itemId: item.id })"
          >
            <DispatchQueueRowBody :request="item.request" :decision="item.decision" />
          </button>
          <button
            type="button"
            class="dispatch-queue-rerun-btn"
            aria-label="Rerun without changes"
            data-tooltip="Rerun without changes (queue for approval again)"
            :disabled="rerunningId === item.id"
            @click="onRerun(item.id)"
          ><span class="mdi mdi-replay" aria-hidden="true"></span></button>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup>
import { inject, ref } from "vue";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import { useToast } from "../composables/useToast.js";
import DispatchQueueRowBody from "./DispatchQueueRowBody.vue";

const modalTitle = inject("modalTitle");
modalTitle.value = "Dispatches";

const viewState = inject("viewState");
const pushView = inject("pushView");
// 通知タップ経由で開いた場合、どのdispatchが通知の元かを示すためのハイライト対象。
// 画面遷移は自動で行わず、一覧内でハイライトするだけに留める。
const highlightId = viewState?.value?.dispatchId ?? null;

const { queue, recent, rerunItem } = useDispatchConfirm();
const toast = useToast();

const rerunningId = ref(/** @type {string | null} */ (null));

async function onRerun(id) {
  rerunningId.value = id;
  try {
    const ok = await rerunItem(id);
    if (ok) toast.success("Requeued for approval");
  } finally {
    rerunningId.value = null;
  }
}
</script>

<style scoped>
.settings-section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 4px 4px 0;
}

.dispatch-queue-desc {
  margin: 0 0 12px;
  padding: 0 4px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
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

.dispatch-queue-rerun-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius, 6px);
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}

.dispatch-queue-rerun-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (hover: hover) and (pointer: fine) {
  .dispatch-queue-rerun-btn:not(:disabled):hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }
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

@media (hover: hover) and (pointer: fine) {
  .dispatch-queue-row-main:hover {
    border-color: var(--accent);
  }
}

.dispatch-queue-recent-label {
  margin-top: 16px;
}

/* 直近の決定項目もクリックでRunViewを開き、内容を編集して再実行できる。
   承認/却下が一目で分かるようアイコン+枠線色で示す。 */
.dispatch-queue-recent-approved {
  border-color: color-mix(in srgb, var(--success) 40%, var(--border));
}

.dispatch-queue-recent-rejected {
  opacity: 0.7;
}
</style>
