<template>
  <BaseDialog :visible="visible" :z-index="10001" @dismiss="cancel">
    <div class="dispatch-prompt-box" role="dialog" aria-modal="true" aria-labelledby="dispatch-prompt-title">
      <h3 id="dispatch-prompt-title" class="dispatch-prompt-title">Run dispatch?</h3>

      <dl class="dispatch-prompt-meta">
        <template v-if="request?.workspace">
          <dt>Workspace</dt>
          <dd>{{ request.workspace }}</dd>
        </template>
        <template v-if="request?.worktree">
          <dt>Worktree</dt>
          <dd>{{ request.worktree }}</dd>
        </template>
      </dl>

      <template v-if="request?.workspace">
        <div class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">Session</span>
          <div class="dispatch-match-options">
            <label class="dispatch-match-option">
              <input type="radio" v-model="selectedMatch" value="existing" /> Use existing
            </label>
            <label class="dispatch-match-option">
              <input type="radio" v-model="selectedMatch" value="new" /> New session
            </label>
          </div>
          <select v-if="selectedMatch === 'existing' && sessions.length > 0" v-model="selectedSessionId" class="dispatch-prompt-select">
            <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
              {{ s.job_label || s.job_name || 'Terminal' }}
            </option>
          </select>
        </div>
        <dl v-if="request?.job" class="dispatch-prompt-meta">
          <dt>Job</dt>
          <dd>{{ jobLabel }}</dd>
        </dl>
        <label v-else class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">Job</span>
          <select v-model="selectedJob" class="dispatch-prompt-select">
            <option value="terminal">Terminal</option>
            <option v-for="job in jobs" :key="job.key" :value="job.key">
              {{ job.label }}
            </option>
          </select>
        </label>
      </template>

      <template v-if="hasBranchField">
        <div class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">Branch</span>
          <div class="dispatch-match-options">
            <label class="dispatch-match-option">
              <input type="radio" v-model="selectedCreateBranch" :value="true" /> Create
            </label>
            <label class="dispatch-match-option">
              <input type="radio" v-model="selectedCreateBranch" :value="false" /> Checkout
            </label>
          </div>
        </div>
        <label class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">
            Branch name
            <span v-if="branchStatusNote" class="dispatch-prompt-note">{{ branchStatusNote }}</span>
          </span>
          <input v-model="branch" type="text" autocomplete="off" spellcheck="false" />
        </label>
        <label class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">Base branch</span>
          <input v-model="baseBranch" type="text" autocomplete="off" spellcheck="false" placeholder="(current)" />
        </label>
      </template>

      <label class="dispatch-prompt-field">
        <span class="dispatch-prompt-label">Input</span>
        <textarea v-model="text" rows="4" autocomplete="off" spellcheck="false"></textarea>
      </label>

      <div class="dialog-buttons">
        <button type="button" class="dialog-btn dialog-btn-cancel" @click="cancel">Cancel</button>
        <button type="button" class="dialog-btn dialog-btn-ok" @click="approve">
          <span class="mdi mdi-play"></span> Run
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import BaseDialog from "./BaseDialog.vue";
import { useDispatchPrompt } from "../composables/useDispatchPrompt.js";
import { useApi } from "../composables/useApi.js";

const { visible, request, branch, baseBranch, text, selectedJob, selectedMatch, selectedSessionId, selectedCreateBranch, approve, cancel } = useDispatchPrompt();
const { apiGet } = useApi();

const jobs = ref([]);
const sessions = ref([]);

const jobLabel = computed(() => {
  const key = request.value?.job;
  if (!key || key === "terminal") return "Terminal";
  return jobs.value.find((j) => j.key === key)?.label || key;
});

watch(visible, async (v) => {
  if (!v) {
    jobs.value = [];
    sessions.value = [];
    return;
  }
  const ws = request.value?.workspace;
  if (!ws) return;
  const [jobsRes, sessionsRes] = await Promise.all([
    apiGet(`/workspaces/${encodeURIComponent(ws)}/jobs`),
    apiGet("/terminal/sessions"),
  ]);
  if (jobsRes.ok && jobsRes.data) {
    jobs.value = Object.entries(jobsRes.data).map(([key, def]) => ({ key, label: def.label || key }));
  }
  if (sessionsRes.ok && Array.isArray(sessionsRes.data)) {
    sessions.value = sessionsRes.data.filter((s) => s.workspace === ws && !s.detached);
  }
});

const hasBranchField = computed(() => !!request.value?.branch || !!request.value?.worktree === false && !!request.value?.create_branch);

const branchStatusNote = computed(() => {
  const status = request.value?.branch_status;
  if (status === "current") return "(already current)";
  if (status === "exists") return "(checkout)";
  if (status === "missing") return request.value?.create_branch ? "(new branch)" : "(missing)";
  return "";
});
</script>

<style scoped>
.dispatch-prompt-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  width: 100%;
  max-width: 420px;
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dispatch-prompt-title {
  margin: 0 0 6px 0;
  font-size: 15px;
  color: var(--accent);
}
.dispatch-prompt-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 13px;
}
.dispatch-prompt-meta dt {
  color: var(--text-secondary);
}
.dispatch-prompt-meta dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-all;
}
.dispatch-match-options {
  display: flex;
  gap: 16px;
}

.dispatch-match-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.dispatch-prompt-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.dispatch-prompt-label {
  color: var(--text-secondary);
  font-size: 12px;
}
.dispatch-prompt-note {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.dispatch-prompt-field input,
.dispatch-prompt-field textarea,
.dispatch-prompt-select {
  padding: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}
.dispatch-prompt-field textarea {
  resize: vertical;
  font-family: monospace;
}
</style>
