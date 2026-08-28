<template>
  <div class="screen-empty-container">
    <div class="screen-empty-content">
      <div class="screen-empty-column screen-empty-column-left">
        <div v-if="setupItems.length > 0" class="screen-empty-section">
          <button
            type="button"
            class="screen-empty-section-label screen-empty-section-toggle"
            :aria-expanded="setupExpanded"
            @click="setupExpanded = !setupExpanded"
          >
            <span class="screen-empty-section-title">
              Setup
              <span v-if="setupChecked && !allSetupDone" class="mdi mdi-alert screen-empty-section-warn" aria-label="Incomplete setup items" data-tooltip="Incomplete setup items"></span>
            </span>
            <span class="mdi" :class="setupExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
          </button>
          <template v-if="setupExpanded">
            <button
              v-for="item in setupItems"
              :key="item.label"
              type="button"
              class="screen-empty-menu-item"
              :class="{ 'screen-empty-menu-item-done': item.done }"
              @click="item.onClick"
            >
              <span :class="`mdi ${item.icon} screen-empty-menu-icon`"></span>
              <span class="screen-empty-menu-label">{{ item.label }}</span>
              <span v-if="item.done" class="mdi mdi-check-circle screen-empty-menu-check" aria-label="Done" data-tooltip="Done"></span>
            </button>
          </template>
        </div>

        <div class="screen-empty-section">
          <div class="screen-empty-section-label">Get Started</div>
          <button type="button" class="screen-empty-menu-item" @click="openTerminal">
            <span class="mdi mdi-console screen-empty-menu-icon"></span>
            <span class="screen-empty-menu-label">New Terminal</span>
            <span class="screen-empty-menu-shortcut">⌘⇧T</span>
          </button>
          <button type="button" class="screen-empty-menu-item" @click="$emit('openWorkspace')">
            <span class="mdi mdi-plus screen-empty-menu-icon"></span>
            <span class="screen-empty-menu-label">Open Session</span>
            <span class="screen-empty-menu-shortcut">⌘⇧N</span>
          </button>
          <button type="button" class="screen-empty-menu-item" @click="openSettings">
            <span class="mdi mdi-cog screen-empty-menu-icon"></span>
            <span class="screen-empty-menu-label">Settings</span>
            <span class="screen-empty-menu-shortcut">⌘⇧.</span>
          </button>
        </div>
      </div>

      <div v-if="recentJobs.length" class="screen-empty-column screen-empty-column-right">
        <div v-if="pinnedJobs.length" class="screen-empty-section">
          <div class="screen-empty-section-label">Pinned Jobs</div>
          <RecentJobsList variant="pinned" />
        </div>
        <div v-if="unpinnedRecentJobs.length" class="screen-empty-section">
          <div class="screen-empty-section-label">Recent Jobs</div>
          <RecentJobsList variant="recent" />
        </div>
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

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRecentJobs } from "../composables/useRecentJobs.ts";
import { emit } from "../app-bridge.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { isMobileUserAgent } from "../utils/device.ts";
import { EP_SYSTEM_INFO, EP_SETTINGS_AUTH, EP_DEVICES } from "../utils/endpoints.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { usePushNotification } from "../composables/usePushNotification.ts";
import { usePwaInstall } from "../composables/usePwaInstall.ts";
import StatusOverlay from "./StatusOverlay.vue";
import RecentJobsList from "./RecentJobsList.vue";

const props = defineProps({
  booting: { type: Boolean, default: false },
  bootMessage: { type: String, default: "Loading..." },
});
defineEmits(["openWorkspace"]);

const bootLabel = computed(() => (props.bootMessage || "Loading").replace(/\.+$/, ""));

const { recentJobs, loadRecentJobs } = useRecentJobs();
const pinnedJobs = computed(() => recentJobs.value.filter((j) => j.pinned));
const unpinnedRecentJobs = computed(() => recentJobs.value.filter((j) => !j.pinned));
const { apiGet } = useApi();
const { confirm } = useConfirm();
const layoutStore = useLayoutStore();
const serverInfo = ref<{ hostname?: string, version?: string, gh_authenticated?: boolean } | null>(null);

// 「Open on your phone」導線: 認証必須な環境で出す一回きりのオンボーディング促し。
// 完了後も項目自体は消さず、チェックマークで完了を示す（何を設定済みか後から
// 見返せるように）。Settings > Auth の「Add new device」ボタンは、複数台追加したい
// 場合の恒久的な導線として引き続き常設する。
const authRequired = ref(false);
const hasMobileDevice = ref(false);
const eligiblePhonePairing = computed(() => authRequired.value);
const donePhonePairing = computed(() => hasMobileDevice.value);

// HTTPS未設定の警告・PWAインストール導線。ローカル開発（localhost/127.0.0.1）では
// HTTPS化は不要なので出さない。HTTPSが無いとPWAインストール自体できないため両者は
// 順序依存（HTTPS化した後にPWA導線が現れる）。完了後も項目は消さずチェックマーク表示にする。
const isLocalDev = ["localhost", "127.0.0.1"].includes(location.hostname);
const eligibleHttpsSetup = computed(() => !isLocalDev);
const doneHttpsSetup = computed(() => location.protocol === "https:");
const eligiblePwaInstall = computed(() => !isLocalDev && location.protocol === "https:");
const donePwaInstall = computed(() => layoutStore.isPwa);

// beforeinstallprompt のキャプチャはモジュールスコープで1つだけ保持する
// （再マウントでのリスナ累積・イベント取り逃し防止。usePwaInstall.ts 参照）。
const { promptInstall } = usePwaInstall();

// PWAインストール済み(=isPwa)の場合に出すpush通知の導線。
// PWA未インストールの間はブラウザ通知の信頼性が低いため、インストール後に出す。
const push = usePushNotification();
const eligibleEnableNotifications = computed(() =>
  layoutStore.isPwa && push.isSupported && push.permission.value !== "denied"
);
const doneEnableNotifications = computed(() => push.isSubscribed.value);

// gh CLI未ログインの警告。ワークスペース単位の条件は設けず常に対象にする。
const eligibleGhAuth = computed(() => true);
const doneGhAuth = computed(() => serverInfo.value?.gh_authenticated === true);

// Setup項目が全て完了していたら初期状態でトグルを閉じる。開閉状態はユーザー操作を
// 尊重し、allSetupDoneが変化した時（=データ読み込み完了時）だけ自動で追従させる。
// Setup 項目の一覧（テンプレート表示・全完了判定・セクション表示可否の
// 3箇所で同じリストを使う — 項目追加はここ1箇所で済ませる）。
const setupItems = computed(() => [
  { eligible: eligibleHttpsSetup.value, done: doneHttpsSetup.value, icon: "mdi-lock-outline", label: "Set up HTTPS", onClick: showHttpsInstructions },
  { eligible: eligiblePwaInstall.value, done: donePwaInstall.value, icon: "mdi-cellphone-arrow-down", label: "Install as app", onClick: installPwa },
  { eligible: eligiblePhonePairing.value, done: donePhonePairing.value, icon: "mdi-cellphone", label: "Open on your phone", onClick: openPhonePairing },
  { eligible: eligibleEnableNotifications.value, done: doneEnableNotifications.value, icon: "mdi-bell-outline", label: "Enable notifications", onClick: enableNotifications },
  { eligible: eligibleGhAuth.value, done: doneGhAuth.value, icon: "mdi-github", label: "Log in to GitHub CLI", onClick: showGhAuthInstructions },
].filter((item) => item.eligible));

const allSetupDone = computed(
  () => setupItems.value.length > 0 && setupItems.value.every((item) => item.done),
);
const setupExpanded = ref(false);
const setupChecked = ref(false);
watch(allSetupDone, (done) => { setupExpanded.value = !done; });

onMounted(async () => {
  loadRecentJobs();
  push.init();
  await Promise.all([loadServerInfo(), loadPhonePairingEligibility()]);
  setupExpanded.value = !allSetupDone.value;
  setupChecked.value = true;
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

async function showHttpsInstructions() {
  await confirm(
    "Run \"tailscale serve --bg http://127.0.0.1:8888\" on the server to expose any-console over HTTPS. "
    + "Use your configured port if you changed it. HTTPS is required for installing this as an app and for push notifications.",
    { ok: { label: "Got it" } },
  );
}

async function showGhAuthInstructions() {
  await confirm(
    "Run \"gh auth login\" on the server (via SSH) so GitHub PR/Actions info can be fetched for your workspaces.",
    { ok: { label: "Got it" } },
  );
}

async function installPwa() {
  if (await promptInstall()) return;
  const instructions = isMobileUserAgent(navigator.userAgent)
    ? "Tap the Share icon, then \"Add to Home Screen\"."
    : "Open your browser's menu and choose \"Install\" (or \"Add to Home Screen\").";
  await confirm(instructions, { ok: { label: "Got it" } });
}

async function enableNotifications() {
  await push.subscribe();
}

function openTerminal() {
  emit("terminal:launch", {});
}
</script>

<style scoped>
.screen-empty-container {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  padding: 24px 16px;
  position: relative;
  overflow-y: auto;
}

.screen-empty-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  max-width: 360px;
  margin: auto;
}

@media (min-width: 769px) {
  .screen-empty-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: start;
    max-width: 640px;
  }

  .screen-empty-column-left {
    grid-column: 1;
  }

  .screen-empty-column-right {
    grid-column: 2;
  }

  .screen-empty-server-info {
    position: absolute;
    right: 16px;
    bottom: 16px;
  }
}

.screen-empty-column {
  display: flex;
  flex-direction: column;
  gap: 20px;
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
  letter-spacing: 0.06em;
  padding: 0 8px;
  margin-bottom: 4px;
}

.screen-empty-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.screen-empty-section-toggle .mdi {
  font-size: 14px;
}

.screen-empty-section-title {
  display: flex;
  align-items: center;
  gap: 4px;
}

.screen-empty-section-warn {
  color: var(--warning, #ffaa00);
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

.screen-empty-menu-icon {
  font-size: 16px;
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  color: var(--text-muted);
}

.screen-empty-menu-item-done {
  opacity: 0.6;
}

.screen-empty-menu-check {
  margin-left: auto;
  font-size: 16px;
  color: var(--success);
  flex-shrink: 0;
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
