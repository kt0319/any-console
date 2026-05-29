<template>
  <div class="dashboard-pane">
    <div class="dashboard-scroll">

      <!-- Quick Actions -->
      <section class="dash-section">
        <div class="dash-section-label">
          <span class="mdi mdi-lightning-bolt dash-section-icon"></span>
          Quick Actions
        </div>
        <div class="dash-actions-row">
          <button class="dash-action-btn" @click="openWorkspace">
            <span class="mdi mdi-plus dash-action-icon"></span>
            <span>Open Workspace</span>
          </button>
          <button class="dash-action-btn" @click="openSettings">
            <span class="mdi mdi-cog dash-action-icon"></span>
            <span>Settings</span>
          </button>
        </div>
      </section>

      <!-- Recent Jobs -->
      <section v-if="recentJobs.length" class="dash-section">
        <div class="dash-section-label">
          <span class="mdi mdi-history dash-section-icon"></span>
          Recent Jobs
        </div>
        <button
          v-for="recent in recentJobs"
          :key="recent.key"
          type="button"
          class="dash-recent-item"
          :class="{ 'is-hidden-tab': recent.jobHiddenTab }"
          @click="runRecentJob(recent)"
        >
          <span class="dash-recent-icons">
            <span v-if="recent.wsIcon" v-html="renderIconStr(recent.wsIcon, recent.wsIconColor, 16)"></span>
            <span v-if="recent.jobIcon" v-html="renderIconStr(recent.jobIcon, recent.jobIconColor, 16)"></span>
          </span>
          <span class="dash-recent-label">
            <span class="dash-recent-ws">{{ recent.workspace }}</span>
            <span v-if="recent.jobLabel || recent.jobName" class="dash-recent-sep">/</span>
            <span class="dash-recent-job">{{ recent.jobLabel || recent.jobName }}</span>
          </span>
        </button>
      </section>

      <!-- Active Sessions -->
      <section v-if="openTabs.length" class="dash-section">
        <div class="dash-section-label">
          <span class="mdi mdi-console dash-section-icon"></span>
          Active Sessions
        </div>
        <button
          v-for="tab in openTabs"
          :key="tab.id"
          type="button"
          class="dash-session-item"
          :class="{ 'dash-session-hidden': tab.hidden }"
          @click="selectTab(tab)"
        >
          <span class="mdi mdi-terminal dash-session-dot" :class="tab.hidden ? '' : 'dot-active'"></span>
          <span class="dash-session-label">
            <span class="dash-session-ws">{{ tab.workspace || 'terminal' }}</span>
            <span v-if="tab.jobLabel || tab.jobName" class="dash-recent-sep">/</span>
            <span v-if="tab.jobLabel || tab.jobName" class="dash-session-job">{{ tab.jobLabel || tab.jobName }}</span>
          </span>
        </button>
      </section>


    </div>
    <StatusOverlay :visible="booting" :label="bootLabel" variant="info" />
  </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useRecentJobs } from "../composables/useRecentJobs.js";
import { useConfirm } from "../composables/useConfirm.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import StatusOverlay from "./StatusOverlay.vue";

const props = defineProps({
  booting: { type: Boolean, default: false },
  bootMessage: { type: String, default: "Loading..." },
});

const bootLabel = computed(() => (props.bootMessage || "Loading").replace(/\.+$/, ""));

const terminalStore = useTerminalStore();
const { recentJobs, loadRecentJobs } = useRecentJobs();
const { confirm } = useConfirm();

const openTabs = computed(() => terminalStore.openTabs.filter((t) => !t.hidden));

// Actions
function openWorkspace() {
  emit("workspace:openModal");
}

function openSettings() {
  emit("settings:open");
}

function selectTab(tab) {
  emit("tab:select", { tab });
}

async function runRecentJob(recent) {
  if (recent.jobConfirm !== false) {
    const preview = recent.jobCommand
      ? (recent.jobCommand.length > 300 ? recent.jobCommand.slice(0, 300) + "..." : recent.jobCommand)
      : recent.jobName;
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

onMounted(() => {
  loadRecentJobs();
});

</script>

<style scoped>
.dashboard-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.dashboard-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.dash-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dash-section-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0 4px;
  margin-bottom: 4px;
}

.dash-section-icon {
  font-size: 13px;
}

.dash-empty-state {
  font-size: 13px;
  color: var(--text-muted);
  padding: 8px 4px;
}

.dash-error {
  color: var(--error);
}

/* Quick Actions */
.dash-actions-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dash-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 13px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  min-height: 0;
}

.dash-action-icon {
  font-size: 16px;
  color: var(--text-muted);
}

/* Recent Jobs */
.dash-recent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  min-height: 0;
}

.dash-recent-item.is-hidden-tab {
  opacity: 0.6;
}

.dash-recent-icons {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  width: 20px;
  justify-content: center;
}

.dash-recent-label {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dash-recent-ws { color: var(--text-muted); }
.dash-recent-sep { color: var(--border); flex-shrink: 0; }
.dash-recent-job {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Active Sessions */
.dash-session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  min-height: 0;
}

.dash-session-dot {
  font-size: 15px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.dash-session-dot.dot-active {
  color: var(--success);
}

.dash-session-hidden {
  opacity: 0.5;
}

.dash-session-label {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dash-session-ws { color: var(--text-secondary); }
.dash-session-job { color: var(--text-muted); }

@media (hover: hover) and (pointer: fine) {
  .dash-action-btn:hover,
  .dash-recent-item:hover,
  .dash-session-item:hover {
    background: var(--bg-tertiary);
  }
}
</style>
