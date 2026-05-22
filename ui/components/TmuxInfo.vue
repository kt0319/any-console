<template>
  <div class="modal-scroll-body">
    <template v-if="!isLoading">
      <div v-if="!info?.available" class="status-message error">tmux is not available on the server</div>
      <template v-else>
        <div class="tmux-row tmux-header">
          <span class="tmux-label">tmux version</span>
          <span class="tmux-value">{{ info.version }}</span>
        </div>
        <div class="tmux-row tmux-header">
          <span class="tmux-label">Sessions</span>
          <span class="tmux-value">{{ info.sessions.length }}</span>
        </div>
        <div v-if="info.sessions.length === 0" class="tmux-empty">No active sessions</div>
        <div v-for="s in info.sessions" :key="s.name" class="tmux-row">
          <span class="tmux-label">{{ s.name }}</span>
          <span class="tmux-value">
            <span class="tmux-tag">{{ s.windows }}w</span>
            <span class="tmux-tag" v-if="s.attached">attached</span>
            <span class="tmux-tag-muted">{{ relativeTime(s.created) }}</span>
          </span>
        </div>
      </template>
    </template>
    <div v-else class="text-muted-center">Loading...</div>
    <div class="tmux-actions">
      <button type="button" class="form-input" :disabled="isLoading" @click="load">
        <span class="mdi mdi-refresh" :class="{ spinning: isLoading }"></span> Refresh
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { EP_SYSTEM_TMUX_INFO } from "../utils/endpoints.js";
import { formatRelativeTime } from "../utils/format.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Tmux Info";

const { apiGet } = useApi();
const info = ref(null);
const isLoading = ref(true);

function relativeTime(unixSec) {
  if (!unixSec) return "";
  return formatRelativeTime(unixSec * 1000);
}

async function load() {
  isLoading.value = true;
  try {
    const { ok, data } = await apiGet(EP_SYSTEM_TMUX_INFO);
    info.value = ok ? data : { available: false, version: "", sessions: [] };
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.tmux-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 4px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  min-height: 32px;
}

.tmux-row:last-of-type {
  border-bottom: none;
}

.tmux-header {
  background: color-mix(in srgb, var(--bg-secondary) 50%, transparent);
}

.tmux-label {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.tmux-value {
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.tmux-tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent-bg-20);
  color: var(--accent);
}

.tmux-tag-muted {
  font-size: 11px;
  color: var(--text-muted);
}

.tmux-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
}

.tmux-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}

.spinning {
  display: inline-block;
  animation: tmux-spin 0.6s linear infinite;
}

@keyframes tmux-spin {
  to { transform: rotate(360deg); }
}
</style>
