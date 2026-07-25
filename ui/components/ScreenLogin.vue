<template>
  <div v-if="visible" class="login-screen">
    <form class="login-box" @submit.prevent="handleLogin">
      <h2>any-console</h2>
      <input
        ref="tokenInput"
        v-model="tokenValue"
        type="password"
        placeholder="Token"
        autocomplete="current-password"
        name="token"
      />
      <div class="login-hint">
        Forgot the token? SSH into <code>{{ hostname }}</code> and check
        <code>data/auth.json</code> inside the any-console directory.
      </div>
      <div v-if="errorMessage" class="login-error">{{ errorMessage }}</div>
      <button class="primary" type="submit" :disabled="submitting">Login</button>
      <button type="button" class="login-scan-btn" @click="openScanner">
        <span class="mdi mdi-qrcode-scan"></span> Scan QR code
      </button>
    </form>
  </div>

  <div v-if="scanner.visible.value" ref="scanModalEl" class="scan-modal" role="dialog" aria-modal="true" aria-label="Scan pairing QR code">
    <div class="scan-box">
      <div class="scan-header">
        <h2>Scan QR code</h2>
        <button type="button" class="scan-close-btn" aria-label="Close" data-tooltip="Close" @click="closeScanner">
          <span class="mdi mdi-close"></span>
        </button>
      </div>
      <video ref="videoEl" v-show="!scanClaiming && !scanError" class="scan-video" muted playsinline></video>
      <div v-if="scanClaiming" class="scan-status">
        <span class="mdi mdi-loading scan-spin"></span>
        Signing in...
      </div>
      <template v-else-if="scanError">
        <div class="scan-status scan-status-error">
          <span class="mdi mdi-alert-circle-outline"></span>
          {{ scanError }}
        </div>
        <button type="button" class="primary scan-retry-btn" @click="closeScanner">Close</button>
      </template>
      <template v-else>
        <div class="scan-status">Point the camera at the pairing QR code.</div>
        <div class="scan-hint">
          On the already-signed-in device, open Settings → Auth → Trusted Devices → Add new device to show the QR code.
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useModal } from "../composables/useModal.js";
import { parsePairUrl } from "../utils/pairing.js";

const auth = useAuthStore();
const emits = defineEmits(["authenticated"]);

const visible = ref(true);
const tokenValue = ref("");
const errorMessage = ref("");
const submitting = ref(false);
const tokenInput = ref(null);
const hostname = window.location.hostname;

const scanner = useModal();
const scanModalEl = ref(null);
const videoEl = ref(null);
const scanClaiming = ref(false);
const scanError = ref("");
let scanStream = null;
let scanFrameId = null;
let decodeQr = null;
const scanCanvas = document.createElement("canvas");
const scanCanvasCtx = scanCanvas.getContext("2d", { willReadFrequently: true });

async function handleLogin() {
  const val = tokenValue.value.trim();
  if (!val || submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";

  const loginResult = await auth.registerDevice(val);
  if (!loginResult.ok) {
    errorMessage.value = loginResult.error;
    submitting.value = false;
    return;
  }

  const result = await auth.checkToken();
  if (result.ok) {
    auth.setServerInfo(result.hostname);
    visible.value = false;
    emits("authenticated");
  } else {
    errorMessage.value = result.error || "Login check failed";
  }
  submitting.value = false;
}

async function openScanner() {
  scanError.value = "";
  scanClaiming.value = false;
  scanner.open(() => scanModalEl.value, closeScanner);
  const [{ default: jsQR }, stream] = await Promise.all([
    import("jsqr"),
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).catch(() => null),
  ]);
  decodeQr = jsQR;
  if (!stream) {
    scanError.value = "Camera access denied or unavailable.";
    return;
  }
  scanStream = stream;
  await nextTick();
  if (!videoEl.value) return;
  videoEl.value.srcObject = scanStream;
  await videoEl.value.play();
  scanFrameId = requestAnimationFrame(scanFrame);
}

function stopScanCamera() {
  if (scanFrameId) {
    cancelAnimationFrame(scanFrameId);
    scanFrameId = null;
  }
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
}

function closeScanner() {
  stopScanCamera();
  scanner.close();
}

function scanFrame() {
  const video = videoEl.value;
  if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
    scanFrameId = requestAnimationFrame(scanFrame);
    return;
  }
  scanCanvas.width = video.videoWidth;
  scanCanvas.height = video.videoHeight;
  scanCanvasCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
  const imageData = scanCanvasCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const code = decodeQr(imageData.data, imageData.width, imageData.height);
  if (code) {
    handleScannedText(code.data);
  } else {
    scanFrameId = requestAnimationFrame(scanFrame);
  }
}

async function handleScannedText(text) {
  const trimmed = text.trim();
  let parsed = null;
  try {
    const url = new URL(trimmed);
    parsed = parsePairUrl(url.pathname, url.search);
  } catch {
    parsed = null;
  }

  stopScanCamera();
  scanClaiming.value = true;
  // ペアリングURL（別デバイスで発行したQR）でなければ、生トークンのQR
  // （初回起動ログのブートストラップQR）として直接ログインを試みる。
  // 無関係なQR（ノイズ）でもサーバ側で単に無効トークン扱いになるだけで安全。
  const result = parsed && parsed.token
    ? await auth.claimPairing(parsed.id, parsed.token)
    : await auth.registerDevice(trimmed);
  if (!result.ok) {
    scanClaiming.value = false;
    scanError.value = result.error || "Pairing failed.";
    return;
  }
  const checkResult = await auth.checkToken();
  if (checkResult.ok) auth.setServerInfo(checkResult.hostname);
  scanClaiming.value = false;
  scanner.close();
  visible.value = false;
  emits("authenticated");
}

function show() {
  visible.value = true;
  tokenValue.value = "";
  errorMessage.value = "";
  nextTick(() => tokenInput.value?.focus());
}

function hide() {
  visible.value = false;
}

defineExpose({ show, hide, visible });
</script>

<style scoped>
.login-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--app-dvh);
  padding: 20px;
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--bg-primary);
}
.login-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 32px;
  width: 100%;
  max-width: 360px;
}
.login-box h2 {
  font-size: 18px;
  margin-bottom: 20px;
  color: var(--accent);
  text-align: center;
}
.login-box input {
  width: 100%;
  padding: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 14px;
  margin-bottom: 16px;
}
.login-box input:focus {
  outline: none;
  border-color: var(--accent);
}
.login-hint {
  color: var(--text-secondary);
  font-size: 12px;
  margin-bottom: 12px;
}
.login-hint code {
  color: var(--text-primary);
}
.login-error {
  color: var(--error);
  font-size: 13px;
  margin-bottom: 12px;
}

.login-scan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: 44px;
  margin-top: 10px;
  padding-top: 16px;
  padding-right: 14px;
  padding-bottom: 10px;
  padding-left: 14px;
  border-top: 1px solid var(--border);
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.login-scan-btn .mdi {
  font-size: 18px;
}

.scan-modal {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--app-dvh);
  padding: 20px;
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: var(--bg-primary);
}
.scan-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  width: 100%;
  max-width: 360px;
}
.scan-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
}
.scan-header h2 {
  font-size: 18px;
  color: var(--accent);
}
.scan-close-btn {
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
.scan-video {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--radius);
  background: #000;
  margin-bottom: 12px;
}
.scan-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
}
.scan-status-error {
  color: var(--error);
}
.scan-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
.scan-retry-btn {
  width: 100%;
  margin-top: 12px;
}
.scan-spin {
  animation: scan-spin 0.6s linear infinite;
}
@keyframes scan-spin {
  to { transform: rotate(360deg); }
}
</style>
