<template>
  <div class="detached-sessions-list">
    <button
      v-for="s in detachedSessions"
      :key="s.tmux_name"
      type="button"
      class="detached-sessions-li"
      :data-session-id="s.session_id || null"
      :title="s.external ? 'Adopt into any-console (rename tmux session)' : 'Open as tab'"
      @click="s.external ? adoptDetached(s) : openDetached(s)"
    >
      <span class="mdi detached-sessions-icon" :class="s.external ? 'mdi-import' : 'mdi-tab-plus'"></span>
      <span class="detached-sessions-label">
        {{ s.workspace || s.job_label || s.job_name || (s.external ? s.tmux_name : "terminal") }}
      </span>
      <span v-if="s.external" class="detached-sessions-tag">external</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useDetachedSessions } from "../composables/useDetachedSessions.ts";

// WorkspaceOpen.vueの「Detached Sessions」カテゴリの中身。タブに紐付いていない
// tmuxセッションの一覧。行自体がボタンで、押すとそのままOpen/Adoptする
// （RecentJobsList.vueと同じ、行全体をクリックターゲットにするパターン）。
// 取得のトリガー（マウント時・タブ数変化時）はRecentJobsList.vueと同じく
// WorkspaceOpen.vue側が持つ（v-ifの判定にも同じdetachedSessionsを使うため）。

const { detachedSessions, openDetached, adoptDetached } = useDetachedSessions();
</script>

<style scoped>
.detached-sessions-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
}

.detached-sessions-li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
}

@media (hover: hover) and (pointer: fine) {
  .detached-sessions-li:hover {
    background: var(--bg-tertiary);
  }
}

.detached-sessions-icon {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--text-muted);
}

.detached-sessions-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.detached-sessions-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
</style>
