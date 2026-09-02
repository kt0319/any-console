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
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";

// SessionListView.vueの通常表示・編集モード表示の両方が使う行1行目の中身
// （アイコン・ラベル・worktree・フレーズ通知）。sessionSidebarItems()が
// 返すitem形状にのみ依存する。ブランチ名/エージェント状態は行2（
// SessionRowMeta.vue）が担当する。

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
</style>
