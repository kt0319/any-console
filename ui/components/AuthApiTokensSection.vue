<template>
  <div>
    <div class="settings-category-head">
      <span class="settings-category-title">API Tokens</span>
    </div>
    <div class="settings-note" style="margin-bottom: 8px;">
      Scoped tokens for external integrations. They only work on <code>POST /dispatch</code> — never anything else.
      <b>dispatch</b> tokens can only queue a request for approval. <b>direct</b> tokens run an agent job immediately in a new session on a worktree, within the limits below, and every run sends a push notification. Both can be given an expiry.
    </div>
    <fieldset class="api-token-scope">
      <legend class="api-token-scope-legend">Scope</legend>
      <label class="form-check-label"><input v-model="newTokenScope" type="radio" value="dispatch" /> dispatch</label>
      <label class="form-check-label"><input v-model="newTokenScope" type="radio" value="direct" /> direct</label>
    </fieldset>
    <div class="api-token-limits">
      <label class="api-token-limit-row">
        <span class="ws-settings-label">Expires at (optional)</span>
        <input v-model="newTokenExpiresAt" type="datetime-local" class="form-input" />
      </label>
      <template v-if="newTokenScope === 'direct'">
        <label class="api-token-limit-row">
          <span class="ws-settings-label">Max runs per day</span>
          <input v-model.number="newTokenMaxPerDay" type="number" min="1" step="1" class="form-input api-token-number" />
        </label>
        <label class="api-token-limit-row">
          <span class="ws-settings-label">Workspace</span>
          <select v-model="newTokenWorkspace" class="form-input">
            <option value="">All workspaces</option>
            <option v-for="w in workspaceNames" :key="w" :value="w">{{ w }}</option>
          </select>
        </label>
      </template>
    </div>
    <div class="ws-settings-row" style="gap:8px">
      <input
        v-model="newTokenName"
        type="text"
        class="form-input"
        placeholder="Token name (e.g. github-actions)"
        maxlength="80"
        @keydown.enter="(e) => runUnlessComposing(e, createApiToken)"
      />
      <button type="button" class="primary" :disabled="creatingToken || !newTokenName.trim() || !limitsValid" @click="createApiToken">
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

    <div v-if="apiTokensLoading" class="text-muted-center loading-dots">Loading</div>
    <template v-else>
      <div v-if="!apiTokens.length" class="settings-note">No API tokens yet.</div>
      <SettingsEntryRow
        v-for="t in apiTokens"
        :key="t.id"
        :sub="tokenSub(t)"
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
import { ref, computed, onMounted } from "vue";
import SettingsEntryRow from "./SettingsEntryRow.vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { EP_API_TOKENS, apiTokenPath } from "../utils/endpoints.ts";
import { formatClockDateTime, formatRelativeTime } from "../utils/format.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";
import { runUnlessComposing } from "../utils/keyboard-event.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";

// API Tokens セクション（作成・一覧・失効）。AuthConfig から分離。

const { apiGet, apiPost, apiDelete } = useApi();
const { confirm } = useConfirm();

// /api-tokens の1件分。max_per_day / allowed_workspaces / expires_at は direct スコープのみ。
type ApiToken = {
  id: string,
  name: string,
  scope: string,
  last_used?: number | null,
  max_per_day?: number,
  allowed_workspaces?: string[],
  expires_at?: number | null,
};

const workspaceStore = useWorkspaceStore();
const workspaceNames = computed<string[]>(() => workspaceStore.allWorkspaces.map((w) => w.name));
const DEFAULT_MAX_PER_DAY = 10;
const newTokenScope = ref<"dispatch" | "direct">("dispatch");
const newTokenMaxPerDay = ref<number>(DEFAULT_MAX_PER_DAY);
const newTokenExpiresAt = ref("");
const newTokenWorkspace = ref("");

const expiresAtEpoch = computed(() => {
  if (!newTokenExpiresAt.value) return null;
  const ms = new Date(newTokenExpiresAt.value).getTime();
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
});
const limitsValid = computed(() => {
  const expires = expiresAtEpoch.value;
  const expiresOk = expires === null || (!Number.isNaN(expires) && expires * 1000 > Date.now());
  const maxOk = newTokenScope.value !== "direct"
    || (Number.isInteger(newTokenMaxPerDay.value) && newTokenMaxPerDay.value >= 1);
  return maxOk && expiresOk;
});

function tokenSub(t: ApiToken): string {
  const lastUsed = `Last used: ${t.last_used ? formatRelativeTime(t.last_used) : "Never"}`;
  const expires = t.expires_at
    ? `${t.expires_at * 1000 <= Date.now() ? "Expired" : "Expires"} ${formatClockDateTime(t.expires_at)}`
    : "No expiry";
  if (t.scope !== "direct") return t.expires_at ? `${expires} · ${lastUsed}` : lastUsed;
  const workspaces = t.allowed_workspaces?.length ? t.allowed_workspaces.join(", ") : "all";
  return `Max ${t.max_per_day ?? DEFAULT_MAX_PER_DAY}/day · Workspaces: ${workspaces} · ${expires} · ${lastUsed}`;
}

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
  if (!name || creatingToken.value || !limitsValid.value) return;
  creatingToken.value = true;
  const body: Record<string, unknown> = { name, scope: newTokenScope.value };
  if (expiresAtEpoch.value !== null) body.expires_at = expiresAtEpoch.value;
  if (newTokenScope.value === "direct") {
    body.max_per_day = newTokenMaxPerDay.value;
    if (newTokenWorkspace.value) body.allowed_workspaces = [newTokenWorkspace.value];
  }
  const { ok, data } = await apiPost(EP_API_TOKENS, body, { errorMessage: "Failed to create token" });
  creatingToken.value = false;
  if (!ok) return;
  createdToken.value = { id: data.id, name: data.name, token: data.token };
  tokenCopied.value = false;
  newTokenName.value = "";
  newTokenScope.value = "dispatch";
  newTokenMaxPerDay.value = DEFAULT_MAX_PER_DAY;
  newTokenExpiresAt.value = "";
  newTokenWorkspace.value = "";
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

onMounted(() => {
  loadApiTokens();
  if (!workspaceStore.allWorkspaces.length) workspaceStore.fetchWorkspaces();
});
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

.api-token-scope {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0 0 8px;
  padding: 0;
  border: none;
}

.api-token-scope-legend {
  padding: 0;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.api-token-limits {
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.api-token-limit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.api-token-number {
  width: 6em;
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
