<template>
  <div class="modal-scroll-body">
    <div v-if="loading" class="text-muted-center">Loading...</div>
    <template v-else>
      <label class="terminal-settings-item terminal-settings-toggle">
        <div class="terminal-settings-toggle-copy">
          <span class="settings-item-label">Require token authentication</span>
          <span class="settings-item-desc">Protect access with a Bearer token</span>
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
    </template>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { EP_SETTINGS_AUTH } from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Auth";

const { apiGet, apiPut } = useApi();

const loading = ref(true);

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
  savingAuth.value = true;
  authSaveMessage.value = "";
  const trimmed = tokenValue.value.trim();
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

onMounted(async () => {
  const authRes = await apiGet(EP_SETTINGS_AUTH);
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
.settings-section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 16px 0 6px;
}

.settings-item-label {
  font-size: 14px;
  color: var(--text-primary);
}

.settings-item-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.terminal-settings-item {
  display: flex;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}

.terminal-settings-toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.terminal-settings-toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.terminal-settings-toggle input[type="checkbox"] {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
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
</style>
