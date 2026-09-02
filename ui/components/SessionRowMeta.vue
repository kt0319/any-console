<template>
  <span class="session-sidebar-meta">
    <span v-if="item.branch" class="session-sidebar-branch-name">
      <span class="mdi mdi-source-branch" aria-hidden="true"></span>{{ item.branch }}
    </span>
    <span v-else></span>
    <span v-if="item.agent" class="session-sidebar-agent" :class="item.agent.className">
      <span class="mdi" :class="item.agent.icon" aria-hidden="true"></span>{{ item.agent.label }}
    </span>
  </span>
</template>

<script setup lang="ts">
// SessionSidebarRow.vue/SessionListView.vue（pending dispatch行）が使う行2の
// 中身（左: ブランチ名、右: エージェント状態/Pendingバッジ）。行1
// （SessionRowContent.vue）から分離し、両方を同時に表示できるようにする。

defineProps({
  item: { type: Object, required: true },
});
</script>

<style scoped>
.session-sidebar-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.session-sidebar-branch-name {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted);
}

.session-sidebar-agent {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-size: 12px;
  white-space: nowrap;
}

.session-sidebar-agent.agent-state-working {
  color: var(--accent);
}

.session-sidebar-agent.agent-state-working .mdi {
  animation: spin 1.6s linear infinite;
}

.session-sidebar-agent.agent-state-blocked {
  color: var(--warning);
}

.session-sidebar-agent.agent-state-done {
  color: var(--success);
}

/* タブがまだ無いワークスペースの承認待ちdispatch行専用（SessionListView.vue、
   実際のエージェント状態ではないが同じバッジ見た目を流用する）。 */
.session-sidebar-agent.agent-state-dispatch-pending {
  color: var(--pink);
}
</style>
