<template>
  <div class="screen-empty-container">
    <div class="screen-empty-content">
      <div class="screen-empty-section">
        <div class="screen-empty-section-label">Get Started</div>
        <button type="button" class="screen-empty-menu-item" @click="$emit('openWorkspace')">
          <span class="mdi mdi-plus screen-empty-menu-icon"></span>
          <span class="screen-empty-menu-label">Open Workspace</span>
          <span class="screen-empty-menu-shortcut">⌘⇧N</span>
        </button>
        <button type="button" class="screen-empty-menu-item" @click="openSettings">
          <span class="mdi mdi-cog screen-empty-menu-icon"></span>
          <span class="screen-empty-menu-label">Settings</span>
          <span class="screen-empty-menu-shortcut">⌘⇧.</span>
        </button>
      </div>

      <div v-if="recentJobs.length" class="screen-empty-section">
        <div class="screen-empty-section-label">Recent Jobs</div>
        <button
          v-for="recent in recentJobs"
          :key="recent.key"
          type="button"
          class="screen-empty-menu-item"
          :class="{ 'is-hidden-tab': recent.jobHiddenTab }"
          @click="runRecentJob(recent)"
        >
          <span class="screen-empty-recent-icons">
            <span v-if="recent.wsIcon" v-html="renderIconStr(recent.wsIcon, recent.wsIconColor, 16)"></span>
            <span v-if="recent.jobIcon" v-html="renderIconStr(recent.jobIcon, recent.jobIconColor, 16)"></span>
          </span>
          <span class="screen-empty-menu-label">
            <span class="screen-empty-recent-ws">{{ recent.workspace }}</span>
            <span v-if="recent.jobLabel || recent.jobName" class="screen-empty-recent-sep">/</span>
            <span class="screen-empty-recent-job">{{ recent.jobLabel || recent.jobName }}</span>
          </span>
        </button>
      </div>

      <div class="screen-empty-booting" :class="{ 'is-hidden': !booting }" aria-live="polite">
        <div class="app-boot-spinner" aria-hidden="true"></div>
        <div class="app-boot-text">{{ bootMessage }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { useRecentJobs } from "../composables/useRecentJobs.js";
import { emit } from "../app-bridge.js";
import { useConfirm } from "../composables/useConfirm.js";
import { renderIconStr } from "../utils/render-icon.js";

defineProps({
  booting: { type: Boolean, default: false },
  bootMessage: { type: String, default: "Loading..." },
});
defineEmits(["openWorkspace"]);

const { recentJobs, loadRecentJobs } = useRecentJobs();
const { confirm } = useConfirm();
onMounted(() => loadRecentJobs());

function openSettings() {
  emit("settings:open");
}

async function runRecentJob(recent) {
  if (recent.jobConfirm !== false) {
    const preview = recent.jobCommand ? (recent.jobCommand.length > 300 ? recent.jobCommand.slice(0, 300) + "..." : recent.jobCommand) : recent.jobName;
    if (!await confirm(`${recent.jobLabel || recent.jobName}\n\n${preview}`)) return;
  }
  emit("terminal:launch", {
    workspace: recent.workspace,
    icon: recent.wsIcon,
    iconColor: recent.wsIconColor,
    jobName: recent.jobName,
    jobLabel: recent.jobLabel,
    jobIcon: recent.jobIcon,
    jobIconColor: recent.jobIconColor,
    initialCommand: recent.jobCommand,
    hidden: !!recent.jobHiddenTab,
  });
}
</script>

<style scoped>
.screen-empty-container {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
}

.screen-empty-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  max-width: 360px;
}

.screen-empty-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.screen-empty-section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0 8px;
  margin-bottom: 4px;
}

.screen-empty-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  min-height: 0;
}

.screen-empty-menu-item.is-hidden-tab {
  opacity: 0.6;
}

.screen-empty-menu-icon {
  font-size: 16px;
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  color: var(--text-muted);
}

.screen-empty-menu-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.screen-empty-menu-shortcut {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
}

.screen-empty-recent-icons {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  width: 20px;
  justify-content: center;
}

.screen-empty-recent-ws {
  color: var(--text-muted);
}

.screen-empty-recent-sep {
  color: var(--border);
  flex-shrink: 0;
}

.screen-empty-recent-job {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.screen-empty-booting {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 56px;
  padding: 8px 0;
}

.screen-empty-booting.is-hidden {
  visibility: hidden;
}

.app-boot-spinner {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent);
  animation: screen-empty-spin 0.8s linear infinite;
}

@keyframes screen-empty-spin {
  to { transform: rotate(360deg); }
}

.app-boot-text {
  color: var(--text-muted);
  font-size: 13px;
}
</style>
