<template>
  <span class="session-sidebar-meta">
    <span v-if="compact && jobIconHtml" class="session-sidebar-meta-job-icon" v-html="jobIconHtml"></span>
    <span v-if="item.branch || item.agent || item.isWorktree" class="session-sidebar-branch-name">
      <span
        v-if="item.agent"
        class="mdi session-sidebar-agent"
        :class="[item.agent.icon, item.agent.className]"
        role="img"
        :aria-label="item.agent.label"
        :data-tooltip="item.agent.label"
      ></span>
      <span
        v-else
        class="mdi"
        :class="item.isWorktree ? 'mdi-file-tree' : 'mdi-source-branch'"
        :aria-label="item.isWorktree ? 'worktree' : undefined"
        :aria-hidden="item.isWorktree ? undefined : 'true'"
      ></span>{{ item.branch }}
    </span>
    <span v-if="compact && item.phraseNotify" class="mdi mdi-bell-ring-outline session-sidebar-meta-notify" aria-label="phrase detected"></span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";

// SessionSidebarRow.vue/SessionListView.vue（pending dispatch行）が使う行2の
// 中身（ブランチ名）。ブランチのアイコンは、エージェント状態/Pendingがある時は
// その状態のアイコンに置き換わる。行1（SessionRowContent.vue）から分離し、
// 両方を同時に表示できるようにする。

const props = defineProps({
  item: { type: Object, required: true },
  // 名前の行（行1）を省いた1行表示。行1が持つジョブアイコンとフレーズ通知をここで出す。
  compact: { type: Boolean, default: false },
});

const jobIconHtml = computed(() => (props.item.jobIcon ? renderIconStr(props.item.jobIcon.name, props.item.jobIcon.color, 18) : ""));
</script>

<style scoped>
.session-sidebar-meta {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.session-sidebar-meta-job-icon {
  display: inline-flex;
  align-items: center;
  width: 18px;
  flex-shrink: 0;
  line-height: 1;
}

.session-sidebar-meta-notify {
  color: var(--warning);
  font-size: 14px;
  flex-shrink: 0;
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
