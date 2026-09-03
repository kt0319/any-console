<template>
  <div class="modal-scroll-body pair-device">
    <div v-if="loading" class="text-muted-center loading-dots">Loading</div>
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
          class="icon-btn-square"
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

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useApi } from "../composables/useApi.ts";
import { useToast } from "../composables/useToast.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";
import { generateQrSvg } from "../utils/qrcode.ts";
import { formatPairingCountdown } from "../utils/pairing.ts";
import { EP_AUTH_PAIRING_START, pairingStatusPath } from "../utils/endpoints.ts";
import {
  PAIRING_STATUS_POLL_MS,
  PAIRING_COUNTDOWN_TICK_MS,
  PAIRING_SUCCESS_CLOSE_DELAY_MS,
  extractApiError,
} from "../utils/constants.ts";

// useModalView の各値は inject（default null はテスト用）。実行時は常に
// provide されるため non-null で扱う。
const modalView = useModalView();
const modalTitle = modalView.modalTitle!;
const popView = modalView.popView!;
modalTitle.value = "Add Device";

const { apiPost, apiGet } = useApi();
const toast = useToast();

const loading = ref(true);
const error = ref("");
const pairingId = ref("");
const pairingUrl = ref("");
const secondsLeft = ref(0);
const status = ref<"pending" | "claimed" | "expired">("pending");
const { copied, copy: copyLink } = useCopyFeedback();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
// unmount後に解決したstatus応答が popView 等の副作用を起こさないためのガード
// （pairingId比較だけでは、unmount後もrefの値は残るため区別できない）。
let isUnmounted = false;
// start()を呼ぶたびに同期的に進める世代カウンタ。「Generate new code」直後、
// 新しいstart()のapiPostがawait中でpairingId.valueがまだ古い値のままの間隙が
// あるため、pairingId比較だけでは旧世代のpoll()応答を弾けない。
let pairingGeneration = 0;

const qrSvg = computed(() => (pairingUrl.value ? generateQrSvg(pairingUrl.value) : ""));
const countdownLabel = computed(() => formatPairingCountdown(secondsLeft.value));

function clearTimers() {
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  if (closeTimer) clearTimeout(closeTimer);
  pollTimer = null;
  tickTimer = null;
  closeTimer = null;
}

async function poll() {
  const requestedId = pairingId.value;
  const requestedGeneration = pairingGeneration;
  if (!requestedId) return;
  const { ok, data } = await apiGet(pairingStatusPath(requestedId));
  if (isUnmounted) return;
  // 世代カウンタで旧pairingの応答を無視する（pairingGeneration宣言部を参照）。
  if (requestedGeneration !== pairingGeneration || requestedId !== pairingId.value) return;
  if (!ok || !data) return;
  if (data.status === "claimed") {
    status.value = "claimed";
    clearTimers();
    toast.success("Device paired successfully");
    closeTimer = setTimeout(() => popView(), PAIRING_SUCCESS_CLOSE_DELAY_MS);
  } else if (data.status === "expired" || data.status === "not_found") {
    status.value = "expired";
    clearTimers();
  }
}

async function start() {
  const generation = ++pairingGeneration;
  loading.value = true;
  error.value = "";
  status.value = "pending";
  copied.value = false;
  clearTimers();
  const { ok, data } = await apiPost(EP_AUTH_PAIRING_START);
  // アンマウント後・追い越され後は状態更新しない（ここでintervalを張ると
  // 二度とclearされず残り続けるため）。
  if (isUnmounted || generation !== pairingGeneration) return;
  loading.value = false;
  if (!ok || !data) {
    // サーバがloopbackアクセス等で具体的な理由(detail)を返すことがある
    // (_build_pairing_url参照)。汎用メッセージで握りつぶさず表示する。
    error.value = extractApiError(data, "Failed to start pairing.");
    return;
  }
  pairingId.value = data.id;
  pairingUrl.value = data.url;
  secondsLeft.value = data.expires_in_sec;
  pollTimer = setInterval(poll, PAIRING_STATUS_POLL_MS);
  tickTimer = setInterval(() => {
    if (secondsLeft.value <= 1) {
      secondsLeft.value = 0;
      // 表示上のカウントダウンを止めるだけ。サーバはexpires_at超過後も
      // `claiming`中のエントリをclaimedへ倒すことがある(claim_pairing参照)ため、
      // pollTimerは止めず、expired/claimedの最終判定はpoll()に委ねる。
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      return;
    }
    secondsLeft.value -= 1;
  }, PAIRING_COUNTDOWN_TICK_MS);
}

async function copyUrl() {
  await copyLink(pairingUrl.value);
}

onMounted(start);
onUnmounted(() => {
  isUnmounted = true;
  clearTimers();
});
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

.pair-status-success { color: var(--success); }
.pair-status-expired { color: var(--warning); }
.pair-status-error { color: var(--error); }
</style>
