<template>
  <div v-if="recentJobs.length" class="picker-recent-section">
    <div class="picker-section-label">Recent</div>
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
    </div>
  </div>
</template>

<script setup>
import { renderIconStr } from "../utils/render-icon.js";

defineProps({
  recentJobs: { type: Array, required: true },
});

defineEmits(["run"]);
</script>

<style scoped>
.picker-recent-section {
  padding: 8px 12px 4px;
  border-bottom: 1px solid var(--border);
}

.picker-section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.picker-recent-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 4px;
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
</style>
