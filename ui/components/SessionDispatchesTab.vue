<template>
  <div class="dispatch-queue-tab">
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
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup>
import { inject } from "vue";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import DispatchQueueRowBody from "./DispatchQueueRowBody.vue";

// Sessionsのタブ帯（SettingsPanel.vue）から開くDispatchesタブの中身。
// 旧DispatchQueueConfig.vue（ModalMenu配下の独立画面）から移植したもの。
// SessionListView.vueに埋め込むのではなく独立したcurrentView（'SessionDispatches'）
// として遷移するため（settingsの内部に一段掘り下げてもタブ帯を消さないため、
// タブ帯自体をSettingsPanel.vue側の常設表示にした。詳細はSettingsPanel.vueのコメント参照）、
// 自分自身のマウント時にmodalTitleを設定する。

const modalTitle = inject("modalTitle");
const viewState = inject("viewState");
const pushView = inject("pushView");
modalTitle.value = "Dispatches";

const highlightId = viewState?.value?.dispatchId ?? null;
const { queue, recent } = useDispatchConfirm();
</script>

<style scoped>
.dispatch-queue-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

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
