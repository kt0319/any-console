<template>
  <div class="screen-empty-container">
    <div class="screen-empty-content">
      <div class="screen-empty-section">
        <div class="screen-empty-section-label">Get Started</div>
        <button type="button" class="screen-empty-menu-item" @click="openTerminal">
          <span class="mdi mdi-console screen-empty-menu-icon"></span>
          <span class="screen-empty-menu-label">New Terminal</span>
          <span class="screen-empty-menu-shortcut">⌘⇧T</span>
        </button>
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
        <button v-if="showPhonePairing" type="button" class="screen-empty-menu-item" @click="openPhonePairing">
          <span class="mdi mdi-cellphone screen-empty-menu-icon"></span>
          <span class="screen-empty-menu-label">Open on your phone</span>
        </button>
      </div>

      <div v-if="recentJobs.length" class="screen-empty-section">
        <div class="screen-empty-section-label">Recent Jobs</div>
        <button
          v-for="recent in recentJobs"
          :key="recent.key"
          type="button"
          class="screen-empty-menu-item"
          :class="{ 'is-detached-tab': recent.jobDetachedTab }"
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

      <div v-if="serverInfo" class="screen-empty-server-info">
        <span class="mdi mdi-server-outline"></span>
        <span>{{ serverInfo.hostname }}</span>
        <span v-if="serverInfo.version" class="screen-empty-server-info-sep">·</span>
        <span v-if="serverInfo.version">{{ serverInfo.version }}</span>
      </div>

    </div>
    <StatusOverlay :visible="booting" :label="bootLabel" variant="info" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useRecentJobs } from "../composables/useRecentJobs.js";
import { emit } from "../app-bridge.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useApi } from "../composables/useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { renderIconStr } from "../utils/render-icon.js";
import { isMobileUserAgent } from "../utils/device.js";
import { EP_SYSTEM_INFO, EP_SETTINGS_AUTH, EP_DEVICES } from "../utils/endpoints.js";
import { useLayoutStore } from "../stores/layout.js";
import StatusOverlay from "./StatusOverlay.vue";

const props = defineProps({
  booting: { type: Boolean, default: false },
  bootMessage: { type: String, default: "Loading..." },
});
defineEmits(["openWorkspace"]);

const bootLabel = computed(() => (props.bootMessage || "Loading").replace(/\.+$/, ""));

const { recentJobs, loadRecentJobs } = useRecentJobs();
const { apiGet } = useApi();
const { confirm } = useConfirm();
const layoutStore = useLayoutStore();
const serverInfo = ref(null);

// 「Open on your phone」導線: モバイル端末を一度もペアリングしていないPCにだけ
// 出す一回きりのオンボーディング促し。一度スマホでの利用が確認できたら
// (=モバイルUAのdeviceが登録済みなら)以後は出さない — 目的は既に達成済みで、
// 恒常的に出し続けるとノイズになるため。Settings > Auth の「Add new device」
// ボタンは、複数台追加したい場合の恒久的な導線として引き続き常設する。
const authRequired = ref(false);
const hasMobileDevice = ref(false);
const showPhonePairing = computed(() =>
  !layoutStore.isPanelBottom && authRequired.value && !hasMobileDevice.value
);

onMounted(() => {
  loadRecentJobs();
  loadServerInfo();
  loadPhonePairingEligibility();
});

async function loadServerInfo() {
  const { ok, data } = await getWithRetry(apiGet, EP_SYSTEM_INFO);
  if (ok && data) serverInfo.value = data;
}

async function loadPhonePairingEligibility() {
  const authRes = await getWithRetry(apiGet, EP_SETTINGS_AUTH);
  authRequired.value = !!authRes.data?.auth_required;
  if (!authRequired.value) return;
  const devicesRes = await getWithRetry(apiGet, EP_DEVICES);
  const devices = devicesRes.ok && Array.isArray(devicesRes.data) ? devicesRes.data : [];
  hasMobileDevice.value = devices.some((d) => isMobileUserAgent(d.user_agent));
}

function openSettings() {
  emit("settings:open");
}

function openPhonePairing() {
  emit("settings:open", { view: "PairDeviceConfig" });
}

function openTerminal() {
  emit("terminal:launch", {});
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
    detached: !!recent.jobDetachedTab,
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
  position: relative;
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

.screen-empty-menu-item.is-detached-tab {
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

.screen-empty-server-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.screen-empty-server-info-sep {
  opacity: 0.6;
}

</style>
