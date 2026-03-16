<template>
  <button
    type="button"
    tabindex="-1"
    class="git-action-btn"
    :class="[btnClass, { running }]"
    :title="title"
    @click.stop="$emit('action')"
  >
    <svg v-if="icon === 'pull'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
    <svg v-else-if="icon === 'push'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
    <svg v-else-if="icon === 'push-upstream'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 16 12 10 18 16"/><polyline points="6 10 12 4 18 10"/></svg>
    <svg v-else-if="icon === 'set-upstream'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
    <span v-if="count != null" class="git-action-count">{{ count }}</span>
  </button>
</template>

<script setup>
defineProps({
  icon: { type: String, required: true },
  title: { type: String, default: "" },
  count: { type: Number, default: null },
  running: { type: Boolean, default: false },
  btnClass: { type: [String, Object, Array], default: "" },
});

defineEmits(["action"]);
</script>

<style scoped>
.git-action-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 36px;
  height: 36px;
  min-height: 36px;
  max-height: 36px;
  padding: 0 8px;
  box-sizing: border-box;
  line-height: 1;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.git-action-btn.icon-only {
  width: 36px;
  padding: 0;
}

.git-action-btn.stash-btn {
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
}

.git-action-btn.pull-btn {
  color: var(--text-muted);
  background: transparent;
}

.git-action-btn.pull-btn.has-count {
  color: var(--error);
  background: rgba(255, 85, 114, 0.15);
  border: 1px solid rgba(255, 85, 114, 0.3);
}

.git-action-btn.push-btn {
  color: var(--text-muted);
  background: transparent;
}

.git-action-btn.push-btn.has-count {
  color: var(--accent);
  background: rgba(130, 170, 255, 0.15);
  border: 1px solid rgba(130, 170, 255, 0.3);
}

.git-action-btn.upstream-set-btn {
  color: var(--warning);
  background: var(--warning-bg-20);
  border: 1px solid rgba(238, 166, 68, 0.3);
}

.git-action-btn.upstream-btn {
  color: var(--success);
  background: var(--success-bg-20);
  border: 1px solid rgba(120, 200, 140, 0.3);
}

.git-action-btn.running {
  pointer-events: none;
  color: transparent;
  background: rgba(130, 170, 255, 0.15);
  border-color: var(--accent);
}

.git-action-btn.running > * {
  visibility: hidden;
}

.git-action-btn.running::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(130, 170, 255, 0.3);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: git-action-spin 0.6s linear infinite;
}

@keyframes git-action-spin {
  to { transform: rotate(360deg); }
}

.git-action-count:empty {
  display: none;
}
</style>
