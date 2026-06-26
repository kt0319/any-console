<template>
  <div class="modal-scroll-body upd-body">
    <div class="upd-row">
      <span class="upd-label">Installed version</span>
      <span class="upd-value">{{ status.version || "unknown" }}</span>
    </div>
    <div v-if="status.branch" class="upd-row">
      <span class="upd-label">Tracking</span>
      <span class="upd-value">{{ status.upstream || status.branch }}</span>
    </div>

    <div v-if="checking" class="upd-note">Checking for updates…</div>

    <template v-else-if="checked">
      <div v-if="!status.fetch_ok" class="status-message error">
        Could not reach the remote. Check network/SSH access and try again.
      </div>
      <div v-else-if="status.update_available" class="upd-callout upd-callout-update">
        <span class="mdi mdi-arrow-up-bold-circle-outline"></span>
        <div>
          <div class="upd-callout-title">Update available</div>
          <div class="upd-callout-note">
            {{ status.behind }} commit{{ status.behind === 1 ? "" : "s" }} behind
            <template v-if="status.latest_release && status.latest_release !== status.current_release">
              · latest release {{ status.latest_release }}
            </template>
          </div>
        </div>
      </div>
      <div v-else class="upd-callout upd-callout-ok">
        <span class="mdi mdi-check-circle-outline"></span>
        <div class="upd-callout-title">You're up to date</div>
      </div>
    </template>

    <div v-if="applied" class="status-message success">
      Updated to {{ status.version }}. Restart any-console to apply
      (<code>./any-console restart</code>, or <code>./any-console run</code> in the foreground).
    </div>
    <div v-if="applyError" class="status-message error">{{ applyError }}</div>

    <div class="upd-actions">
      <button type="button" @click="check" :disabled="checking || applying">
        <span class="mdi mdi-refresh" :class="{ spinning: checking }"></span> Check again
      </button>
      <button
        v-if="checked && status.update_available && status.fetch_ok && !applied"
        type="button"
        class="primary"
        @click="apply"
        :disabled="applying"
      >
        {{ applying ? "Updating…" : "Update now (git pull)" }}
      </button>
    </div>

    <p class="upd-hint">
      Updates pull the latest commits of the tracked branch (which includes the newest
      release). Dependency or frontend changes take effect after a restart.
    </p>
  </div>
</template>

<script setup>
import { ref, reactive, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { EP_SYSTEM_UPDATE_CHECK, EP_SYSTEM_UPDATE_APPLY } from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Check for Update";

const { apiGet, apiPost } = useApi();
const { confirm } = useConfirm();

const status = reactive({
  version: "", branch: "", upstream: "",
  behind: 0, ahead: 0, update_available: false, fetch_ok: true,
  current_release: "", latest_release: "",
});
const checking = ref(false);
const checked = ref(false);
const applying = ref(false);
const applied = ref(false);
const applyError = ref("");

async function check() {
  checking.value = true;
  applied.value = false;
  applyError.value = "";
  const { ok, data } = await apiGet(EP_SYSTEM_UPDATE_CHECK, {
    errorMessage: "Failed to check for updates",
  });
  if (ok && data) Object.assign(status, data);
  checked.value = ok;
  checking.value = false;
}

async function apply() {
  if (!await confirm(`Pull the latest changes onto ${status.branch}? A restart is required to apply them.`)) return;
  applying.value = true;
  applyError.value = "";
  const { ok, data } = await apiPost(EP_SYSTEM_UPDATE_APPLY, {});
  if (ok && data?.ok) {
    if (data.version) status.version = data.version;
    status.update_available = false;
    applied.value = true;
  } else {
    applyError.value = data?.detail || "Update failed";
  }
  applying.value = false;
}

onMounted(check);
</script>

<style scoped>
.upd-body { display: flex; flex-direction: column; gap: 12px; }

.upd-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.upd-label { color: var(--text-secondary); }
.upd-value { color: var(--text-primary); font-variant-numeric: tabular-nums; }

.upd-note { color: var(--text-muted); font-size: 13px; padding: 4px; }

.upd-callout {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.upd-callout .mdi { font-size: 24px; flex-shrink: 0; }
.upd-callout-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.upd-callout-note { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.upd-callout-update { border-color: var(--accent); background: var(--accent-bg-20); }
.upd-callout-update .mdi { color: var(--accent); }
.upd-callout-ok { border-color: var(--success); background: var(--success-bg-20); }
.upd-callout-ok .mdi { color: var(--success); }

.upd-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.upd-actions .primary { width: auto; flex: 1; }

.upd-hint { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-top: 4px; }
.upd-hint code, .status-message code {
  background: var(--bg-tertiary);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}

.spinning { display: inline-block; animation: spin 0.6s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
