<template>
  <div>
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
      <SettingsEntryRow
        v-for="t in apiTokens"
        :key="t.id"
        :sub="`Last used: ${t.last_used ? formatRelativeTime(t.last_used) : 'Never'}`"
      >
        <template #name>
          {{ t.name }}
          <span class="device-tag">{{ t.scope }}</span>
        </template>
        <template #action>
          <button
            type="button"
            class="icon-btn-square danger"
            aria-label="Revoke API token"
            data-tooltip="Revoke API token"
            @click="revokeApiToken(t)"
          >
            <span class="mdi mdi-trash-can-outline"></span>
          </button>
        </template>
      </SettingsEntryRow>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import SettingsEntryRow from "./SettingsEntryRow.vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { EP_API_TOKENS, apiTokenPath } from "../utils/endpoints.ts";
import { formatRelativeTime } from "../utils/format.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";

// API Tokens セクション（作成・一覧・失効）。AuthConfig から分離。

const { apiGet, apiPost, apiDelete } = useApi();
const { confirm } = useConfirm();

// /api-tokens の1件分。
type ApiToken = { id: string, name: string, scope: string, last_used?: number | null };

const apiTokens = ref<ApiToken[]>([]);
const apiTokensLoading = ref(true);
const newTokenName = ref("");
const creatingToken = ref(false);
const createdToken = ref<{ id: string, name: string, token: string } | null>(null);
const { copied: tokenCopied, copy: copyCreatedTokenText } = useCopyFeedback();

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

async function revokeApiToken(t: ApiToken) {
  if (!await confirm(`Revoke API token "${t.name}"? Workflows using it will stop working. This cannot be undone.`)) return;
  const { ok } = await apiDelete(apiTokenPath(t.id), { errorMessage: "Failed to revoke" });
  if (!ok) return;
  if (createdToken.value?.id === t.id) createdToken.value = null;
  await loadApiTokens();
}

onMounted(loadApiTokens);
</script>

<style scoped>
.settings-category-head {
  margin: 24px 0 10px;
}

.device-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg-primary);
}

.security-token-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
}

.security-token-input {
  flex: 1;
  box-sizing: border-box;
  padding: 8px;
  font-size: 14px;
  font-family: monospace;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.api-token-created {
  margin: 8px 0 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
}
</style>
