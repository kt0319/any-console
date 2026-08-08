<template>
  <ul class="detached-sessions-list">
    <li v-for="s in detachedSessions" :key="s.tmux_name" class="detached-sessions-li" :data-session-id="s.session_id || null">
      <span class="detached-sessions-main">
        <span class="mdi mdi-tab-plus detached-sessions-icon"></span>
        <span class="detached-sessions-label">
          {{ s.workspace || s.job_label || s.job_name || (s.external ? s.tmux_name : "terminal") }}
        </span>
        <span v-if="s.external" class="detached-sessions-tag">external</span>
      </span>
      <span class="detached-sessions-actions">
        <button v-if="!s.external" type="button" class="detached-sessions-btn" @click="openDetached(s)" title="Open as tab">
          <span class="mdi mdi-tab-plus"></span>
        </button>
        <button v-else type="button" class="detached-sessions-btn" @click="adoptDetached(s)" title="Adopt into any-console (rename tmux session)">
          <span class="mdi mdi-import"></span>
        </button>
        <button type="button" class="detached-sessions-btn danger" @click="closeDetached(s)" title="Close session">
          <span class="mdi mdi-close"></span>
        </button>
      </span>
    </li>
  </ul>
</template>

<script setup>
import { useDetachedSessions } from "../composables/useDetachedSessions.js";

// WorkspaceOpen.vueの「Detached」カテゴリの中身。タブに紐付いていない
// tmuxセッションの一覧・Open/Adopt/Close操作（データ源・API呼び出しは
// useDetachedSessions.js）。取得のトリガー（マウント時・タブ数変化時）は
// RecentJobsList.vueと同じくWorkspaceOpen.vue側が持つ（v-ifの判定にも
// 同じdetachedSessionsを使うため）。

const { detachedSessions, openDetached, adoptDetached, closeDetached } = useDetachedSessions();
</script>

<style scoped>
.detached-sessions-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.detached-sessions-li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.detached-sessions-li:last-child {
  border-bottom: none;
}

.detached-sessions-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
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

.detached-sessions-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.detached-sessions-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
}

.detached-sessions-btn.danger:hover {
  background: color-mix(in srgb, var(--error) 20%, var(--bg-tertiary));
  color: var(--error);
}
</style>
