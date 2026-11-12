<template>
  <span class="session-sidebar-meta">
    <span v-if="item.branch || item.agent" class="session-sidebar-branch-name">
      <span
        v-if="item.agent"
        class="mdi session-sidebar-agent"
        :class="[item.agent.icon, item.agent.className]"
        role="img"
        :aria-label="item.agent.label"
        :data-tooltip="item.agent.label"
      ></span>
      <span v-else class="mdi mdi-source-branch" aria-hidden="true"></span>{{ item.branch }}
    </span>
  </span>
</template>

<script setup lang="ts">
// SessionSidebarRow.vue/SessionListView.vue（pending dispatch行）が使う行2の
// 中身（ブランチ名）。ブランチのアイコンは、エージェント状態/Pendingがある時は
// その状態のアイコンに置き換わる。行1（SessionRowContent.vue）から分離し、
// 両方を同時に表示できるようにする。

defineProps({
  item: { type: Object, required: true },
});
</script>

<style scoped>
.session-sidebar-meta {
  display: flex;
  flex: 1;
  align-items: center;
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
  font-size: 14px;
  color: var(--text-muted);
}

.session-sidebar-branch-name .mdi {
  font-size: 18px;
}

.session-sidebar-agent.agent-state-working {
  color: var(--accent);
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
