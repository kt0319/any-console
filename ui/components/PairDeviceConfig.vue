<template>
  <div class="modal-scroll-body pair-device">
    <div v-if="loading" class="text-muted-center">Loading...</div>
    <template v-else-if="error">
      <div class="pair-status pair-status-error">
        <span class="mdi mdi-alert-circle-outline"></span>
        {{ error }}
      </div>
      <button type="button" class="primary" @click="start">Try again</button>
    </template>
    <template v-else-if="status === 'claimed'">
      <div class="pair-status pair-status-success">
        <span class="mdi mdi-check-circle"></span>
        Device paired successfully.
      </div>
    </template>
    <template v-else-if="status === 'expired'">
      <div class="pair-status pair-status-expired">
        <span class="mdi mdi-clock-alert-outline"></span>
        This code expired.
      </div>
      <button type="button" class="primary" @click="start">Generate new code</button>
    </template>
    <template v-else>
      <div class="settings-item-desc">
        Scan this code with the camera app on your new device. It signs in automatically — no token needed.
      </div>
      <div
        class="pair-qr"
        role="img"
        :aria-label="`QR code to add a new device, expires in ${countdownLabel}`"
        v-html="qrSvg"
      ></div>
      <div class="pair-countdown">Expires in {{ countdownLabel }}</div>
      <div class="pair-url-row">
        <code class="pair-url">{{ pairingUrl }}</code>
        <button
          type="button"
          class="pair-copy-btn"
          :aria-label="copied ? 'Copied' : 'Copy link'"
          :data-tooltip="copied ? 'Copied!' : 'Copy link'"
          @click="copyUrl"
        >
          <span class="mdi" :class="copied ? 'mdi-check' : 'mdi-content-copy'"></span>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { copyText } from "../utils/clipboard.js";
import { generateQrSvg } from "../utils/qrcode.js";
import { formatPairingCountdown } from "../utils/pairing.js";
import { EP_AUTH_PAIRING_START, pairingStatusPath } from "../utils/endpoints.js";
import { PAIRING_STATUS_POLL_MS, PAIRING_COUNTDOWN_TICK_MS, URL_COPIED_RESET_MS } from "../utils/constants.js";
import { emit } from "../app-bridge.js";

const { modalTitle, popView } = useModalView();
modalTitle.value = "Add Device";

const { apiPost, apiGet } = useApi();

const loading = ref(true);
const error = ref("");
const pairingId = ref("");
const pairingUrl = ref("");
const secondsLeft = ref(0);
/** @type {import("vue").Ref<"pending" | "claimed" | "expired">} */
const status = ref("pending");
const copied = ref(false);

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let tickTimer = null;

const qrSvg = computed(() => (pairingUrl.value ? generateQrSvg(pairingUrl.value) : ""));
const countdownLabel = computed(() => formatPairingCountdown(secondsLeft.value));

function clearTimers() {
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

async function poll() {
  if (!pairingId.value) return;
  const { ok, data } = await apiGet(pairingStatusPath(pairingId.value));
  if (!ok || !data) return;
  if (data.status === "claimed") {
    status.value = "claimed";
    clearTimers();
    emit("toast:show", { message: "Device paired successfully", type: "success" });
    setTimeout(() => popView(), 1200);
  } else if (data.status === "expired" || data.status === "not_found") {
    status.value = "expired";
    clearTimers();
  }
}

async function start() {
  loading.value = true;
  error.value = "";
  status.value = "pending";
  copied.value = false;
  clearTimers();
  const { ok, data } = await apiPost(EP_AUTH_PAIRING_START);
  loading.value = false;
  if (!ok || !data) {
    error.value = "Failed to start pairing.";
    return;
  }
  pairingId.value = data.id;
  pairingUrl.value = data.url;
  secondsLeft.value = data.expires_in_sec;
  pollTimer = setInterval(poll, PAIRING_STATUS_POLL_MS);
  tickTimer = setInterval(() => {
    if (secondsLeft.value <= 1) {
      secondsLeft.value = 0;
      status.value = "expired";
      clearTimers();
      return;
    }
    secondsLeft.value -= 1;
  }, PAIRING_COUNTDOWN_TICK_MS);
}

async function copyUrl() {
  await copyText(pairingUrl.value);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, URL_COPIED_RESET_MS);
}

onMounted(start);
onUnmounted(clearTimers);
</script>

<style scoped>
.pair-device {
  align-items: center;
  text-align: center;
  gap: 12px;
}

.pair-qr {
  width: 220px;
  max-width: 100%;
  aspect-ratio: 1;
  margin: 8px auto;
  padding: 12px;
  background: #fff;
  border-radius: var(--radius);
}

.pair-qr :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.pair-countdown {
  font-size: 13px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.pair-url-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 360px;
}

.pair-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  padding: 6px 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  text-align: left;
}

.pair-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  margin: 12px 0;
}

.pair-status .mdi {
  font-size: 20px;
}

.pair-copy-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.pair-status-success { color: var(--success); }
.pair-status-expired { color: var(--warning); }
.pair-status-error { color: var(--error); }
</style>
