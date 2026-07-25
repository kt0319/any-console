<template>
  <div class="modal-scroll-body">
    <div v-if="loading" class="text-muted-center">Loading...</div>
    <template v-else>
      <label class="settings-item settings-toggle">
        <div class="settings-toggle-copy">
          <span class="settings-item-label">Require token authentication</span>
          <span class="settings-note">
            Protect access with a Bearer token.
            Tailscale connections can skip token authentication, but only when trust_tailscale_auth is enabled in config.json (off by default).
          </span>
        </div>
        <input type="checkbox" v-model="enabled" @change="onToggle" />
      </label>

      <template v-if="enabled">
        <div v-if="tokenConfigured" class="security-token-status configured">
          <span class="mdi mdi-check-circle"></span>
          Token is configured
        </div>
        <div v-else class="security-token-status missing">
          <span class="mdi mdi-alert-circle-outline"></span>
          No token set yet
        </div>

        <div class="settings-section-label">{{ tokenConfigured ? "Replace token" : "Token" }}</div>
        <div class="security-token-row">
          <input
            :type="showToken ? 'text' : 'password'"
            v-model="tokenValue"
            class="security-token-input"
            :placeholder="tokenConfigured ? 'Enter a new token to replace' : 'Enter a token'"
            autocomplete="new-password"
          />
          <button type="button" class="security-icon-btn" :title="showToken ? 'Hide' : 'Show'" @click="showToken = !showToken">
            <span :class="['mdi', showToken ? 'mdi-eye-off' : 'mdi-eye']"></span>
          </button>
          <button type="button" class="security-icon-btn" title="Generate random token" @click="generateToken">
            <span class="mdi mdi-refresh"></span>
          </button>
        </div>
        <div v-if="tokenConfigured" class="security-token-hint">Leave blank to keep the current token.</div>
      </template>

      <button type="button" class="primary" :disabled="savingAuth" @click="saveAuth">
        {{ savingAuth ? "Saving..." : "Save" }}
      </button>
      <div v-if="authSaveMessage" class="form-message" :class="authSaveMessageType">{{ authSaveMessage }}</div>

      <div class="settings-section-label">Trusted Devices</div>
      <div class="settings-note" style="margin-bottom: 8px;">
        Registered devices can sign in without entering a token. Revoke any device that should no longer have access.
      </div>
      <button
        v-if="tokenConfigured"
        type="button"
        class="add-device-btn"
        @click="pushView('PairDeviceConfig')"
      >
        <span class="mdi mdi-qrcode-scan"></span> Add new device
      </button>
      <div v-if="devicesLoading" class="text-muted-center">Loading...</div>
      <template v-else>
        <div v-if="!devices.length" class="settings-note">No devices registered yet.</div>
        <div v-for="d in devices" :key="d.id" class="device-row">
          <div class="device-meta">
            <span class="device-name">
              {{ d.name }}
              <span v-if="d.current" class="device-tag">This device</span>
              <span v-if="d.source && d.source !== 'token'" class="device-tag source">{{ d.source }}</span>
            </span>
            <span class="device-sub">Last seen: {{ formatRelativeTime(d.last_seen_at) }}</span>
          </div>
          <button type="button" class="security-icon-btn" :title="d.current ? 'Logout' : 'Revoke'" @click="revoke(d)">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { useConfirm } from "../composables/useConfirm.js";
import { EP_SETTINGS_AUTH } from "../utils/endpoints.js";
import { formatRelativeTime } from "../utils/format.js";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Auth";

const { apiGet, apiPut, apiDelete } = useApi();
const { confirm } = useConfirm();

const loading = ref(true);
const devices = ref([]);
const devicesLoading = ref(true);

const enabled = ref(false);
const tokenConfigured = ref(false);
const tokenValue = ref("");
const showToken = ref(false);
const savingAuth = ref(false);
const authSaveMessage = ref("");
const authSaveMessageType = ref("success");

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  tokenValue.value = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  showToken.value = true;
}

function onToggle() {
  if (!enabled.value) tokenValue.value = "";
}

async function saveAuth() {
  if (enabled.value && !tokenValue.value.trim()) {
    authSaveMessage.value = "Token is required when authentication is enabled.";
    authSaveMessageType.value = "error";
    return;
  }
  const trimmed = tokenValue.value.trim();
  if (!enabled.value && tokenConfigured.value) {
    if (!await confirm("Disable authentication and revoke the current token? Anyone with network access can use this console.")) return;
  } else if (enabled.value && trimmed && tokenConfigured.value) {
    if (!await confirm("Replace the current token? Existing clients will need the new token.")) return;
  }
  savingAuth.value = true;
  authSaveMessage.value = "";
  const { ok } = await apiPut(EP_SETTINGS_AUTH, { enabled: enabled.value, token: trimmed }, { errorMessage: "Failed to save" });
  savingAuth.value = false;
  if (ok) {
    tokenValue.value = "";
    if (enabled.value) {
      if (trimmed || tokenConfigured.value) tokenConfigured.value = true;
    } else {
      tokenConfigured.value = false;
    }
    authSaveMessage.value = enabled.value ? "Saved. Reload the page if your token changed." : "Authentication disabled.";
    authSaveMessageType.value = "success";
  } else {
    authSaveMessage.value = "Failed to save.";
    authSaveMessageType.value = "error";
  }
}

async function loadDevices() {
  devicesLoading.value = true;
  const res = await getWithRetry(apiGet, "/devices");
  devices.value = res.ok && Array.isArray(res.data) ? res.data : [];
  devicesLoading.value = false;
}

async function revoke(d) {
  const isSelf = !!d.current;
  const msg = isSelf
    ? `Logout this device "${d.name}"? You will need to sign in again.`
    : `Revoke device "${d.name}"? It will need to register again with a token.`;
  if (!await confirm(msg)) return;
  const { ok } = await apiDelete(`/devices/${encodeURIComponent(d.id)}`, { errorMessage: "Failed to revoke" });
  if (!ok) return;
  if (isSelf) {
    location.reload();
    return;
  }
  await loadDevices();
}

onMounted(async () => {
  const authRes = await getWithRetry(apiGet, EP_SETTINGS_AUTH);
  if (authRes.ok) {
    enabled.value = !!authRes.data.auth_required;
    tokenConfigured.value = !!authRes.data.auth_required;
  }
  loading.value = false;
  await loadDevices();
});
</script>

<style>
@import "../styles/form-message.css";
</style>

<style scoped>
.settings-section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 16px 0 6px;
}

.security-token-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
}

.security-token-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  font-size: 14px;
  font-family: monospace;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.security-token-row .security-token-input {
  flex: 1;
  width: auto;
}

.security-icon-btn {
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

.security-token-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 4px 0 12px;
  word-break: break-all;
}

.security-token-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 10px;
  font-size: 13px;
  word-break: break-all;
}

.security-token-status .mdi {
  font-size: 18px;
  flex-shrink: 0;
}

.security-token-status.configured { color: var(--success); }
.security-token-status.missing { color: var(--warning); }

.add-device-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  margin-bottom: 8px;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}

.add-device-btn .mdi {
  font-size: 18px;
}

.device-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}
.device-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.device-name {
  font-size: 14px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.device-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg-primary);
}
.device-tag.source {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
.device-sub {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
