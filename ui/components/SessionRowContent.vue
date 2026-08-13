<template>
  <span class="session-sidebar-main">
    <span v-if="wsIconHtml" class="session-sidebar-icon" v-html="wsIconHtml"></span>
    <span v-if="jobIconHtml" class="session-sidebar-icon" v-html="jobIconHtml"></span>
    <span v-if="!wsIconHtml && !jobIconHtml" class="mdi mdi-console session-sidebar-icon session-sidebar-icon-default"></span>
    <span v-if="item.isWorktree" class="mdi mdi-file-tree session-sidebar-worktree" aria-label="worktree"></span>
    <span class="session-sidebar-label" :class="{ 'session-sidebar-label-dim': dim }">{{ item.label }}</span>
    <span v-if="item.phraseNotify" class="mdi mdi-bell-ring-outline session-sidebar-notify" aria-label="phrase detected"></span>
    <span v-if="item.agent" class="session-sidebar-agent" :class="item.agent.className">
      <span class="mdi" :class="item.agent.icon" aria-hidden="true"></span>{{ item.agent.label }}
    </span>
  </span>
  <span v-if="item.branch" class="session-sidebar-sub">
    <span class="session-sidebar-branch">
      <span class="session-sidebar-branch-name">{{ item.branch }}</span>
    </span>
    <span v-if="item.dirty" class="session-sidebar-changes">
      <span class="session-sidebar-changes-files">{{ item.changedFiles }}F</span> <span class="session-sidebar-changes-numstat" v-html="numstatHtml"></span>
    </span>
  </span>
</template>

<script setup>
import { computed } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";
import { buildNumstatHtml } from "../utils/git.ts";

// SessionListView.vueの通常表示・編集モード表示の両方が使う行の中身
// （アイコン・ラベル・worktree・フレーズ通知・エージェント状態・ブランチ・
// 変更差分）。sessionSidebarItems()が返すitem形状にのみ依存する。

const props = defineProps({
  item: { type: Object, required: true },
  // タブがまだ無いpendingワークスペース行（SessionListView.vue）用。
  // アクティブなセッションではないことが伝わるよう名前を控えめな色にする。
  dim: { type: Boolean, default: false },
});

const wsIconHtml = computed(() => (props.item.wsIcon ? renderIconStr(props.item.wsIcon.name, props.item.wsIcon.color, 18) : ""));
const jobIconHtml = computed(() => (props.item.jobIcon ? renderIconStr(props.item.jobIcon.name, props.item.jobIcon.color, 18) : ""));
const numstatHtml = computed(() => buildNumstatHtml(props.item.insertions, props.item.deletions));
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
  color: var(--accent);
  font-size: 14px;
  flex-shrink: 0;
}

.session-sidebar-sub {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
  padding-left: 24px;
  font-size: 12px;
  color: var(--text-muted);
}

.session-sidebar-branch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.session-sidebar-branch-name {
  overflow-wrap: anywhere;
}

.session-sidebar-changes {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  white-space: nowrap;
}

/* PillPeek.vueのpill-peek-changes-filesと同じ配色に揃える */
.session-sidebar-changes-files {
  color: var(--warning);
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
