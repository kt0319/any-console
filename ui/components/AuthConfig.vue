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
            Protect access with a Bearer token. Signed-in devices can continue with their device cookie.
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

      <AuthDevicesSection :token-configured="tokenConfigured" @add-device="pushView('PairDeviceConfig')" />
      <AuthApiTokensSection />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import AuthDevicesSection from "./AuthDevicesSection.vue";
import AuthApiTokensSection from "./AuthApiTokensSection.vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { EP_SETTINGS_AUTH } from "../utils/endpoints.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";
import { useModalView } from "../composables/useModalView.ts";
import { generateHexToken } from "../utils/token.ts";

// Auth 設定画面のホスト。User Token セクションを持ち、Trusted Devices /
// API Tokens は独立した子セクション（AuthDevicesSection / AuthApiTokensSection）。

// 設定モーダル配下でのみ使われるため provide 値は常に入っている（useModalView.ts 参照）。
const modalView = useModalView();
const pushView = modalView.pushView!;
modalView.modalTitle!.value = "Auth";

const { apiGet, apiPut } = useApi();
const { confirm } = useConfirm();

const loading = ref(true);

const enabled = ref(false);
const tokenConfigured = ref(false);
const tokenValue = ref("");
const { copied: tokenValueCopied, copy: copyTokenValueText } = useCopyFeedback();
const savingAuth = ref(false);
const authSaveMessage = ref("");
const authSaveMessageType = ref("success");

function generateToken() {
  tokenValue.value = generateHexToken(32);
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

onMounted(async () => {
  const authRes = await getWithRetry(apiGet, EP_SETTINGS_AUTH);
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
</style>
