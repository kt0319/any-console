<template>
  <div class="screen-empty-container">
    <div class="screen-empty-content">
      <div class="screen-empty-actions">
        <button type="button" class="screen-empty-open-btn" @click="$emit('openWorkspace')">
          <span class="mdi mdi-plus"></span> Open Workspace
        </button>
      </div>

      <div v-if="recentJobs.length" class="screen-empty-ws-list">
        <div class="screen-empty-section-label">Recent</div>
        <div class="screen-empty-ws-buttons">
          <button
            v-for="recent in recentJobs"
            :key="recent.key"
            type="button"
            class="screen-empty-ws-btn"
            :class="{ 'is-hidden-tab': recent.jobHiddenTab }"
            @click="runRecentJob(recent)"
          >
            <span v-if="recent.wsIcon" class="ws-btn-icon" v-html="renderIconStr(recent.wsIcon, recent.wsIconColor, 18)"></span>
            <span v-if="recent.jobIcon" class="ws-btn-icon" v-html="renderIconStr(recent.jobIcon, recent.jobIconColor, 18)"></span>
          </button>
        </div>
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

function openWorkspace(ws) {
  emit("terminal:launch", {
    workspace: ws.name,
    icon: ws.icon,
    iconColor: ws.icon_color,
  });
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
  min-height: 100%;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.screen-empty-content {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  width: 100%;
  max-width: 360px;
}

.screen-empty-ws-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
}

.screen-empty-ws-buttons {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px;
}

.screen-empty-ws-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-family: inherit;
}

.screen-empty-ws-btn.is-hidden-tab {
  border-style: dashed;
}

.ws-btn-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  font-size: 18px;
  color: var(--text-secondary);
}


.screen-empty-section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}

.screen-empty-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.screen-empty-open-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 24px;
  font-size: 14px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.screen-empty-booting {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 56px;
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
