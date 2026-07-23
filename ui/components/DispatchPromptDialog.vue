<template>
  <BaseDialog :visible="visible" :z-index="10001" @dismiss="cancel">
    <div class="dispatch-prompt-box" role="dialog" aria-modal="true" aria-labelledby="dispatch-prompt-title">
      <h3 id="dispatch-prompt-title" class="dispatch-prompt-title">Run dispatch?</h3>

      <template v-if="request?.workspace">
        <label class="dispatch-prompt-field">
          <span class="dispatch-prompt-label">Session</span>
          <select v-model="selectedSessionId" class="dispatch-prompt-select">
            <option :value="NEW_SESSION_VALUE">+ New session</option>
            <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
              {{ s.workspace ? `${s.workspace} / ${s.job_label || s.job_name || 'Terminal'}` : (s.job_label || s.job_name || 'Terminal') }}
            </option>
          </select>
        </label>

        <!-- New session: Workspace / Job を選択 -->
        <template v-if="isNewSession">
          <label class="dispatch-prompt-field">
            <span class="dispatch-prompt-label">Workspace</span>
            <select v-model="selectedWorkspace" class="dispatch-prompt-select">
              <option v-for="w in workspaceOptions" :key="w.name" :value="w.name">{{ w.name }}</option>
            </select>
          </label>
          <dl v-if="showWorktreeInfo" class="dispatch-prompt-meta">
            <dt>Worktree</dt>
            <dd>{{ request.worktree }}</dd>
          </dl>
          <label class="dispatch-prompt-field">
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
          <label class="dispatch-match-option">
            <input type="checkbox" v-model="selectedCreateBranch" /> Create branch
          </label>
          <label class="dispatch-prompt-field">
            <span class="dispatch-prompt-label">
              Branch name
              <span v-if="branchStatusNote" class="dispatch-prompt-note">{{ branchStatusNote }}</span>
            </span>
            <input v-model="branch" type="text" autocomplete="off" spellcheck="false" :disabled="!selectedCreateBranch" />
          </label>
          <label class="dispatch-prompt-field">
            <span class="dispatch-prompt-label">Base branch</span>
            <select v-model="baseBranch" class="dispatch-prompt-select" :disabled="!selectedCreateBranch">
              <option value="">(current branch)</option>
              <option v-for="b in localBranches" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
        </template>
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
import { NEW_SESSION_VALUE, useDispatchPrompt } from "../composables/useDispatchPrompt.js";
import { useApi } from "../composables/useApi.js";
import { useWorkspaceStore } from "../stores/workspace.js";

const { visible, request, branch, baseBranch, text, selectedWorkspace, selectedJob, selectedSessionId, isNewSession, selectedCreateBranch, approve, cancel } = useDispatchPrompt();
const { apiGet } = useApi();
const workspaceStore = useWorkspaceStore();

const jobs = ref([]);
const sessions = ref([]);
const localBranches = ref([]);

// worktree はドロップダウンの選択肢に含めない（ベースワークスペースのみ選択可能）ため、
// 元のリクエストのworktree情報は選択中ワークスペースが変わっていない時だけ表示する。
const workspaceOptions = computed(() => workspaceStore.allWorkspaces.filter((w) => !w.worktree));
const showWorktreeInfo = computed(() => !!request.value?.worktree && selectedWorkspace.value === request.value?.workspace);

watch(visible, async (v) => {
  if (!v) {
    jobs.value = [];
    sessions.value = [];
    localBranches.value = [];
    return;
  }
  const sessionsRes = await apiGet("/terminal/sessions");
  if (sessionsRes.ok && Array.isArray(sessionsRes.data)) {
    sessions.value = sessionsRes.data.filter((s) => !s.detached);
  }
});

watch(selectedWorkspace, async (ws) => {
  jobs.value = [];
  if (!ws || !visible.value) return;
  const res = await apiGet(`/workspaces/${encodeURIComponent(ws)}/jobs`);
  if (res.ok && res.data) {
    jobs.value = Object.entries(res.data).map(([key, def]) => ({ key, label: def.label || key }));
  }
  if (selectedJob.value !== "terminal" && !jobs.value.some((j) => j.key === selectedJob.value)) {
    selectedJob.value = "terminal";
  }
}, { immediate: true });

// Base branch のブランチ一覧: 選択中セッションのワークスペースまたは選択中のワークスペース
const baseBranchWorkspace = computed(() => {
  if (!isNewSession.value && selectedSessionId.value) {
    const s = sessions.value.find((s) => s.session_id === selectedSessionId.value);
    return s?.workspace || request.value?.workspace;
  }
  return selectedWorkspace.value;
});

watch(baseBranchWorkspace, async (ws) => {
  localBranches.value = [];
  if (!ws || !visible.value) return;
  const res = await apiGet(`/workspaces/${encodeURIComponent(ws)}/branches`);
  if (res.ok && Array.isArray(res.data)) {
    localBranches.value = res.data.map((b) => b.name);
  }
  if (baseBranch.value && !localBranches.value.includes(baseBranch.value)) {
    baseBranch.value = "";
  }
}, { immediate: true });

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
.dispatch-prompt-field input:not([type="radio"]),
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
.dispatch-prompt-field input:disabled,
.dispatch-prompt-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dispatch-prompt-field textarea {
  resize: vertical;
  font-family: monospace;
}
</style>
