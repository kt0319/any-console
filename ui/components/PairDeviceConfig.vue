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

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { useCopyFeedback } from "../composables/useCopyFeedback.js";
import { generateQrSvg } from "../utils/qrcode.js";
import { formatPairingCountdown } from "../utils/pairing.js";
import { EP_AUTH_PAIRING_START, pairingStatusPath } from "../utils/endpoints.js";
import {
  PAIRING_STATUS_POLL_MS,
  PAIRING_COUNTDOWN_TICK_MS,
  PAIRING_SUCCESS_CLOSE_DELAY_MS,
  extractApiError,
} from "../utils/constants.js";
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
const { copied, copy: copyLink } = useCopyFeedback();

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let tickTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let closeTimer = null;
// unmount後に解決したstatus応答が、共有viewStackに対してpopView等の副作用を
// 起こさないようにするガード(pairingId比較だけでは、unmount後もrefの値自体は
// 変わらず残るため、古いpairingへの切り替わりとunmountを区別できない)。
let isUnmounted = false;
// start()を呼ぶたびに進める世代カウンタ。「Generate new code」で古いpairingの
// pollがin-flightのまま新しいstart()のapiPostがまだ解決していない間は、
// pairingId.value自体はまだ古い値のままなので、pairingId比較だけでは
// 古い応答を弾けない(start()が自身のawaitを終えて上書きするまでの間隙)。
// start()の冒頭で同期的にインクリメントすることで、そのawait中に届いた
// 旧世代の応答を確実に無効化する。
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
  // start() が再度呼ばれ別のpairingへ切り替わった後にこの応答が返ってきた場合、
  // 新しいpairingの状態を古い応答で上書きしてしまわないよう無視する。
  // 世代カウンタで判定する(pairingId比較だけだと、新しいstart()がまだ自身の
  // apiPostをawait中でpairingId.valueを上書きする前の間隙をすり抜けてしまう)。
  if (requestedGeneration !== pairingGeneration || requestedId !== pairingId.value) return;
  if (!ok || !data) return;
  if (data.status === "claimed") {
    status.value = "claimed";
    clearTimers();
    emit("toast:show", { message: "Device paired successfully", type: "success" });
    closeTimer = setTimeout(() => popView(), PAIRING_SUCCESS_CLOSE_DELAY_MS);
  } else if (data.status === "expired" || data.status === "not_found") {
    status.value = "expired";
    clearTimers();
  }
}

async function start() {
  // apiPostのawait前に同期的に進める — これより後に届く旧世代のpoll()応答を
  // (pairingId.valueがまだ書き換わっていない間隙も含めて)確実に無効化する。
  const generation = ++pairingGeneration;
  loading.value = true;
  error.value = "";
  status.value = "pending";
  copied.value = false;
  clearTimers();
  const { ok, data } = await apiPost(EP_AUTH_PAIRING_START);
  // アンマウント後、または自身より新しいstart()に追い越された後に解決した
  // 場合、ここから先で新しいintervalを張ってしまうと二度とclearされず
  // 残り続けるため、状態更新自体を行わない。
  if (isUnmounted || generation !== pairingGeneration) return;
  loading.value = false;
  if (!ok || !data) {
    // サーバがloopbackアクセス等で具体的な理由(detail)を返すことがある
    // (_build_pairing_url参照)。汎用メッセージで握りつぶさず、その理由を
    // 表示することでユーザーが対処できるようにする。
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
      // 表示上のカウントダウンを止めるだけ。status/pollTimerには触れない —
      // サーバはclaim進行中のエントリをexpires_atを過ぎても`claiming`のまま
      // 保持し、後から claimed へ倒すことがある(claim_pairing参照)。ここで
      // pollTimerまで止めてしまうと、その後の成功をissuer側が永久に観測
      // できなくなる。expired/claimedの最終判定はpoll()の応答(サーバ側)に
      // 委ねる。
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
