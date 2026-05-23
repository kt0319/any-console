<template>
  <div class="picker-recent-section">
    <div class="picker-recent-list">
      <button
        v-for="recent in recentJobs"
        :key="recent.key"
        type="button"
        class="picker-recent-btn"
        :class="{ 'is-hidden-tab': recent.jobHiddenTab }"
        @click="$emit('run', recent)"
      >
        <span v-if="recent.wsIcon" v-html="renderIconStr(recent.wsIcon, recent.wsIconColor, 18)"></span>
        <span v-if="recent.jobIcon" v-html="renderIconStr(recent.jobIcon, recent.jobIconColor, 18)"></span>
      </button>
      <button type="button" class="picker-recent-settings-btn" :class="{ active: settingsActive }" title="Workspace Settings" @click="$emit('settings')">
        <span class="mdi mdi-cog-outline"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { renderIconStr } from "../utils/render-icon.js";

defineProps({
  recentJobs: { type: Array, required: true },
  settingsActive: { type: Boolean, default: false },
});

defineEmits(["run", "settings"]);
</script>

<style scoped>
.picker-recent-section {
  padding: 8px 12px 4px;
  border-bottom: 1px solid var(--border);
}

.picker-recent-list {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding-bottom: 4px;
}

.picker-recent-settings-btn {
  margin-left: auto;
}

.picker-recent-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  font-family: inherit;
}

.picker-recent-btn.is-hidden-tab {
  border-style: dashed;
}

.picker-recent-settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  font-family: inherit;
}

.picker-recent-settings-btn.active {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}

</style>
