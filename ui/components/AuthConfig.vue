<template>
  <div class="modal-scroll-body">
    <div v-if="loading" class="text-muted-center">Loading...</div>
    <template v-else>
      <div class="settings-category-head">
        <span class="settings-category-title">{{ tokenConfigured ? "Replace user token" : "User Token" }}</span>
        <span v-if="enabled && tokenConfigured" class="security-token-status configured">
          <span class="mdi mdi-check-circle"></span>
          Configured
        </span>
        <span v-else-if="enabled" class="security-token-status missing">
          <span class="mdi mdi-alert-circle-outline"></span>
          Not set
        </span>
      </div>
      <label class="settings-item settings-toggle">
        <input type="checkbox" v-model="enabled" @change="onToggle" />
        <div class="settings-toggle-copy">
          <span class="settings-item-label">Require token authentication</span>
          <span class="settings-note">
            Protect access with a Bearer token. Tailscale can skip it only if trust_tailscale_auth is enabled in config.json.
          </span>
        </div>
      </label>

      <template v-if="enabled">
        <div class="security-token-row">
          <input
            type="text"
            v-model="tokenValue"
            class="security-token-input"
            :placeholder="tokenConfigured ? 'Enter a new user token to replace' : 'Enter a user token'"
            autocomplete="new-password"
          />
          <button
            type="button"
            class="icon-btn-square"
            :disabled="!tokenValue"
            aria-label="Copy user token"
            data-tooltip="Copy user token"
            @click="copyTokenValue"
          >
            <span :class="['mdi', tokenValueCopied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
          <button
            type="button"
            class="icon-btn-square security-labeled-btn"
            aria-label="Regenerate token"
            data-tooltip="Regenerate token"
            @click="generateToken"
          >
            <span class="mdi mdi-refresh"></span>
            Regenerate
          </button>
          <button
            type="button"
            class="primary auth-save-btn"
            :disabled="savingAuth || (!tokenConfigured && !tokenValue.trim())"
            @click="saveAuth"
          >
            {{ savingAuth ? "Saving..." : "Save" }}
          </button>
        </div>
        <div v-if="tokenConfigured" class="security-token-hint">Leave blank to keep the current token.</div>
      </template>
      <div v-else class="auth-save-row">
        <button type="button" class="primary auth-save-btn" :disabled="savingAuth" @click="saveAuth">
          {{ savingAuth ? "Saving..." : "Save" }}
        </button>
      </div>
      <div v-if="authSaveMessage" class="form-message" :class="authSaveMessageType">{{ authSaveMessage }}</div>

      <div class="settings-category-head">
        <span class="settings-category-title">Trusted Devices</span>
        <button
          v-if="tokenConfigured"
          type="button"
          class="auth-card-action"
          @click="pushView('PairDeviceConfig')"
        >
          <span class="mdi mdi-qrcode-scan"></span> Add new device
        </button>
      </div>
      <div class="settings-note" style="margin-bottom: 8px;">
        Registered devices can sign in without entering a token. Revoke any device that should no longer have access.
      </div>
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
          <button
            type="button"
            class="icon-btn-square danger"
            :aria-label="d.current ? 'Logout' : 'Revoke device'"
            :data-tooltip="d.current ? 'Logout' : 'Revoke'"
            @click="revoke(d)"
          >
            <span class="mdi" :class="d.current ? 'mdi-logout' : 'mdi-trash-can-outline'"></span>
          </button>
        </div>
      </template>

      <div class="settings-category-head">
        <span class="settings-category-title">API Tokens</span>
      </div>
      <div class="settings-note" style="margin-bottom: 8px;">
        Scoped tokens for external integrations (e.g. GitHub Actions). They can only queue a dispatch request — never approve one or access anything else.
      </div>
      <div class="ws-settings-row" style="gap:8px">
        <input
          v-model="newTokenName"
          type="text"
          class="form-input"
          placeholder="Token name (e.g. github-actions)"
          maxlength="80"
          @keydown.enter="createApiToken"
        />
        <button type="button" class="primary" :disabled="creatingToken || !newTokenName.trim()" @click="createApiToken">
          {{ creatingToken ? "Creating..." : "Create" }}
        </button>
      </div>

      <div v-if="createdToken" class="api-token-created">
        <div class="settings-note">Copy this token now — it will not be shown again.</div>
        <div class="security-token-row">
          <input :value="createdToken.token" type="text" readonly class="security-token-input" aria-label="New API token" />
          <button
            type="button"
            class="icon-btn-square"
            aria-label="Copy token"
            data-tooltip="Copy token"
            @click="copyCreatedToken"
          >
            <span :class="['mdi', tokenCopied ? 'mdi-check' : 'mdi-content-copy']"></span>
          </button>
        </div>
      </div>

      <div v-if="apiTokensLoading" class="text-muted-center">Loading...</div>
      <template v-else>
        <div v-if="!apiTokens.length" class="settings-note">No API tokens yet.</div>
        <div v-for="t in apiTokens" :key="t.id" class="device-row">
          <div class="device-meta">
            <span class="device-name">
              {{ t.name }}
              <span class="device-tag">{{ t.scope }}</span>
            </span>
            <span class="device-sub">Last used: {{ t.last_used ? formatRelativeTime(t.last_used) : "Never" }}</span>
          </div>
          <button
            type="button"
            class="icon-btn-square danger"
            aria-label="Revoke API token"
            data-tooltip="Revoke API token"
            @click="revokeApiToken(t)"
          >
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.js";
import { EP_SETTINGS_AUTH, EP_DEVICES, devicePath, EP_API_TOKENS, apiTokenPath } from "../utils/endpoints.ts";
import { formatRelativeTime } from "../utils/format.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.js";
import { useModalView } from "../composables/useModalView.js";

const { modalTitle, pushView } = useModalView();
modalTitle.value = "Auth";

const { apiGet, apiPost, apiPut, apiDelete } = useApi();
const { confirm } = useConfirm();

const loading = ref(true);
const devices = ref([]);
const devicesLoading = ref(true);

const apiTokens = ref([]);
const apiTokensLoading = ref(true);
const newTokenName = ref("");
const creatingToken = ref(false);
const createdToken = ref(/** @type {{id: string, name: string, token: string}|null} */ (null));
const { copied: tokenCopied, copy: copyCreatedTokenText } = useCopyFeedback();

const enabled = ref(false);
const tokenConfigured = ref(false);
const tokenValue = ref("");
const { copied: tokenValueCopied, copy: copyTokenValueText } = useCopyFeedback();
const savingAuth = ref(false);
const authSaveMessage = ref("");
const authSaveMessageType = ref("success");

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  tokenValue.value = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function copyTokenValue() {
  if (!tokenValue.value) return;
  await copyTokenValueText(tokenValue.value);
}

function onToggle() {
  if (!enabled.value) tokenValue.value = "";
}

async function saveAuth() {
  if (enabled.value && !tokenConfigured.value && !tokenValue.value.trim()) {
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
  const res = await getWithRetry(apiGet, EP_DEVICES);
  devices.value = res.ok && Array.isArray(res.data) ? res.data : [];
  devicesLoading.value = false;
}

async function revoke(d) {
  const isSelf = !!d.current;
  const msg = isSelf
    ? `Logout this device "${d.name}"? You will need to sign in again.`
    : `Revoke device "${d.name}"? It will need to register again with a token.`;
  if (!await confirm(msg)) return;
  const { ok } = await apiDelete(devicePath(d.id), { errorMessage: "Failed to revoke" });
  if (!ok) return;
  if (isSelf) {
    location.reload();
    return;
  }
  await loadDevices();
}

async function loadApiTokens() {
  apiTokensLoading.value = true;
  const res = await getWithRetry(apiGet, EP_API_TOKENS);
  apiTokens.value = res.ok && Array.isArray(res.data) ? res.data : [];
  apiTokensLoading.value = false;
}

async function createApiToken() {
  const name = newTokenName.value.trim();
  if (!name || creatingToken.value) return;
  creatingToken.value = true;
  const { ok, data } = await apiPost(EP_API_TOKENS, { name }, { errorMessage: "Failed to create token" });
  creatingToken.value = false;
  if (!ok) return;
  createdToken.value = { id: data.id, name: data.name, token: data.token };
  tokenCopied.value = false;
  newTokenName.value = "";
  await loadApiTokens();
}

async function copyCreatedToken() {
  if (!createdToken.value) return;
  await copyCreatedTokenText(createdToken.value.token);
}

async function revokeApiToken(t) {
  if (!await confirm(`Revoke API token "${t.name}"? Workflows using it will stop working. This cannot be undone.`)) return;
  const { ok } = await apiDelete(apiTokenPath(t.id), { errorMessage: "Failed to revoke" });
  if (!ok) return;
  if (createdToken.value?.id === t.id) createdToken.value = null;
  await loadApiTokens();
}

onMounted(async () => {
  const [authRes] = await Promise.all([
    getWithRetry(apiGet, EP_SETTINGS_AUTH),
    loadDevices(),
    loadApiTokens(),
  ]);
  if (authRes.ok) {
    enabled.value = !!authRes.data.auth_required;
    tokenConfigured.value = !!authRes.data.auth_required;
  }
  loading.value = false;
});
</script>

<style>
@import "../styles/form-message.css";
</style>

<style scoped>
.settings-category-head {
  margin: 24px 0 10px;
}
.settings-category-head:first-child {
  margin-top: 0;
}
.auth-card-action {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-height: 44px;
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.auth-card-action .mdi {
  font-size: 16px;
}

.auth-save-row {
  display: flex;
  justify-content: flex-end;
}

.auth-save-btn {
  width: auto;
  min-width: 96px;
  padding: 8px 20px;
}

.security-token-row {
  display: flex;
  flex-wrap: wrap;
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

.security-labeled-btn {
  width: auto;
  gap: 6px;
  padding: 0 12px;
  font-size: 13px;
}
.security-labeled-btn .mdi {
  font-size: 16px;
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

.settings-category-head .security-token-status {
  margin: 0;
  flex-shrink: 0;
  font-size: 12px;
}

.security-token-status .mdi {
  font-size: 18px;
  flex-shrink: 0;
}

.security-token-status.configured { color: var(--success); }
.security-token-status.missing { color: var(--warning); }

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

.api-token-created {
  margin: 8px 0 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
}
</style>
