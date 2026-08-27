<template>
  <span class="session-sidebar-main">
    <span v-if="wsIconHtml" class="session-sidebar-icon session-sidebar-icon-badge-wrap">
      <span v-html="wsIconHtml"></span>
      <span v-if="item.dirty" class="session-sidebar-dirty-badge" aria-label="uncommitted changes"></span>
    </span>
    <span v-if="jobIconHtml" class="session-sidebar-icon" v-html="jobIconHtml"></span>
    <span v-if="!wsIconHtml && !jobIconHtml" class="mdi mdi-console session-sidebar-icon session-sidebar-icon-default"></span>
    <span v-if="item.isWorktree" class="mdi mdi-file-tree session-sidebar-worktree" aria-label="worktree"></span>
    <span class="session-sidebar-label" :class="{ 'session-sidebar-label-dim': dim }">{{ item.label }}</span>
    <span v-if="item.phraseNotify" class="mdi mdi-bell-ring-outline session-sidebar-notify" aria-label="phrase detected"></span>
    <span v-if="item.agent" class="session-sidebar-agent" :class="item.agent.className">
      <span class="mdi" :class="item.agent.icon" aria-hidden="true"></span>{{ item.agent.label }}
    </span>
    <span v-else-if="item.branch" class="session-sidebar-branch-name">
      <span class="mdi mdi-source-branch" aria-hidden="true"></span>{{ item.branch }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";

// SessionListView.vueの通常表示・編集モード表示の両方が使う行1行目の中身
// （アイコン・ラベル・worktree・エージェント状態バッジ/フレーズ通知/ブランチ名）。
// sessionSidebarItems()が返すitem形状にのみ依存する。ワークスペース名（左、
// flex:1で伸縮）の右側に、agentがあればステータスバッジ、無ければブランチ名を
// 同じ位置に排他表示する。

const props = defineProps({
  item: { type: Object, required: true },
  // タブがまだ無いpendingワークスペース行（SessionListView.vue）用。
  // アクティブなセッションではないことが伝わるよう名前を控えめな色にする。
  dim: { type: Boolean, default: false },
});

const wsIconHtml = computed(() => (props.item.wsIcon ? renderIconStr(props.item.wsIcon.name, props.item.wsIcon.color, 18) : ""));
const jobIconHtml = computed(() => (props.item.jobIcon ? renderIconStr(props.item.jobIcon.name, props.item.jobIcon.color, 18) : ""));
</script>

<style scoped>
.session-sidebar-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.session-sidebar-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex-shrink: 0;
  line-height: 1;
}

.session-sidebar-icon-default {
  color: var(--text-muted);
  font-size: 16px;
}

.session-sidebar-icon-badge-wrap {
  position: relative;
}

.session-sidebar-dirty-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f5a623;
  border: 1px solid var(--bg-secondary);
}

.session-sidebar-worktree {
  font-size: 13px;
  color: var(--accent);
  flex-shrink: 0;
}

.session-sidebar-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.session-sidebar-label-dim {
  color: var(--text-muted);
  font-weight: 400;
}

.session-sidebar-notify {
  color: var(--warning);
  font-size: 14px;
  flex-shrink: 0;
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

/* ワークスペース名（.session-sidebar-label、flex:1）が残り幅を優先的に取り、
   ブランチ名はその右に縮小しつつ収まる（長い場合は末尾を省略）。 */
.session-sidebar-branch-name {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted);
}

</style>
