<template>
  <div class="modal-scroll-body">
    <div v-if="request" class="ws-settings-section">
      <div class="ws-settings-row">
        <span class="ws-settings-label">Session</span>
        <select v-model="selectedSessionId" class="form-input">
          <option :value="NEW_SESSION_VALUE">+ New session</option>
          <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
            {{ s.workspace ? `${s.workspace} / ${s.job_label || s.job_name || 'Terminal'}` : (s.job_label || s.job_name || 'Terminal') }}
          </option>
        </select>
      </div>

      <!-- Workspace / Job: 新規セッション時のみ有効（既存セッション選択時は参考表示のみ） -->
      <div class="ws-settings-row">
        <span class="ws-settings-label">Workspace</span>
        <select v-model="selectedWorkspace" class="form-input" :disabled="!isNewSession">
          <option v-for="w in workspaceOptions" :key="w.name" :value="w.name">{{ w.name }}</option>
        </select>
      </div>
      <dl v-if="showWorktreeInfo" class="dispatch-run-meta">
        <dt>Worktree</dt>
        <dd>{{ request.worktree }}</dd>
      </dl>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Job</span>
        <select v-model="selectedJob" class="form-input" :disabled="!isNewSession">
          <option value="terminal">Terminal</option>
          <option v-for="job in jobs" :key="job.key" :value="job.key">
            {{ job.label }}
          </option>
        </select>
      </div>

      <template v-if="hasBranchField">
        <div class="ws-settings-row" style="gap:8px">
          <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="selectedCreateBranch" /> Create branch</label>
        </div>
        <div class="ws-settings-row ws-settings-row-stack">
          <span class="ws-settings-label">
            Branch name
            <span v-if="branchStatusNote" class="dispatch-run-note">{{ branchStatusNote }}</span>
          </span>
          <input v-model="branch" type="text" class="form-input" autocomplete="off" spellcheck="false" :disabled="!selectedCreateBranch" />
        </div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">Base branch</span>
          <select v-model="baseBranch" class="form-input" :disabled="!selectedCreateBranch">
            <option value="">(current branch)</option>
            <option v-for="b in localBranches" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
      </template>

      <div class="ws-settings-row ws-settings-row-stack">
        <span class="ws-settings-label">Input</span>
        <textarea v-model="text" class="form-input dispatch-run-input" rows="4" autocomplete="off" spellcheck="false"></textarea>
      </div>

      <div class="ws-settings-row" style="gap:8px">
        <button type="button" class="primary" :disabled="running" @click="run">
          <span class="mdi mdi-play"></span> {{ running ? "Running..." : "Run" }}
        </button>
      </div>
      <div v-if="runError" class="job-config-error">{{ runError }}</div>
    </div>

    <div v-if="request" class="ws-settings-section ws-delete-section">
      <button type="button" class="ws-delete-btn" :disabled="discarding" @click="discard">
        <span class="mdi mdi-close"></span>
        {{ discarding ? "Discarding..." : "Discard dispatch" }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useModalView } from "../composables/useModalView.js";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit, on } from "../app-bridge.js";

// Session select の「新規セッション」を表す特別値。
const NEW_SESSION_VALUE = "__new__";

const { modalTitle, viewState, popView } = useModalView();
const { apiGet } = useApi();
const { confirm } = useConfirm();
const { queue, focusItem, runItem, rejectItem } = useDispatchConfirm();
const workspaceStore = useWorkspaceStore();

const itemId = viewState.value?.itemId;
const item = computed(() => queue.value.find((q) => q.id === itemId) || null);
const request = computed(() => item.value?.request || null);

modalTitle.value = "Run Dispatch";

const branch = ref("");
const baseBranch = ref("");
const text = ref("");
const selectedWorkspace = ref("");
const selectedJob = ref("terminal");
const selectedSessionId = ref(NEW_SESSION_VALUE);
const selectedCreateBranch = ref(false);
const isNewSession = computed(() => selectedSessionId.value === NEW_SESSION_VALUE);

const jobs = ref([]);
const sessions = ref([]);
const localBranches = ref([]);
const running = ref(false);
const discarding = ref(false);
const runError = ref("");

function initFromRequest(req) {
  branch.value = req?.branch || "";
  baseBranch.value = req?.base_branch || "";
  text.value = req?.text || "";
  selectedWorkspace.value = req?.workspace || "";
  selectedJob.value = req?.job || "terminal";
  selectedSessionId.value = req?.existing_session_id || NEW_SESSION_VALUE;
  selectedCreateBranch.value = !!req?.create_branch;
}

// worktree はドロップダウンの選択肢に含めない（ベースワークスペースのみ選択可能）ため、
// 元のリクエストのworktree情報は選択中ワークスペースが変わっていない時だけ表示する。
const workspaceOptions = computed(() => workspaceStore.allWorkspaces.filter((w) => !w.worktree));
const showWorktreeInfo = computed(() => !!request.value?.worktree && selectedWorkspace.value === request.value?.workspace);

// worktree 上の dispatch はブランチが既に固定されているため、ブランチ操作の
// 項目自体を出さない。それ以外は常に表示し、Create branch のチェック有無で
// Branch name / Base branch を disable/enable する（hide/show は使わない）。
const hasBranchField = computed(() => !request.value?.worktree);

const branchStatusNote = computed(() => {
  const status = request.value?.branch_status;
  if (status === "current") return "(already current)";
  if (status === "exists") return "(checkout)";
  if (status === "missing") return selectedCreateBranch.value ? "(new branch)" : "(missing)";
  return "";
});

onMounted(() => {
  if (!item.value) { popView(); return; }
  initFromRequest(request.value);
  focusItem(itemId);
});

const offItemRemoved = on("dispatch:itemRemoved", ({ id }) => {
  if (id === itemId) popView();
});
onUnmounted(offItemRemoved);

watch(selectedSessionId, () => {
  apiGet("/terminal/sessions").then((res) => {
    if (res.ok && Array.isArray(res.data)) sessions.value = res.data.filter((s) => !s.detached);
  });
}, { immediate: true });

// 既存セッションを選んだら、そのセッションの実際の Workspace / Job を
// プレビュー表示に反映する（disabled のままだが選択中セッションに追従させる）。
// 新規セッションに戻したら元のリクエスト値に戻す。
watch(selectedSessionId, (id) => {
  if (id === NEW_SESSION_VALUE) {
    selectedWorkspace.value = request.value?.workspace || "";
    selectedJob.value = request.value?.job || "terminal";
    return;
  }
  const s = sessions.value.find((s) => s.session_id === id);
  if (!s) return;
  selectedWorkspace.value = s.workspace || selectedWorkspace.value;
  selectedJob.value = s.job_name || "terminal";
});

watch(selectedWorkspace, async (ws) => {
  jobs.value = [];
  if (!ws) return;
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
  if (!ws) return;
  const res = await apiGet(`/workspaces/${encodeURIComponent(ws)}/branches`);
  if (res.ok && Array.isArray(res.data)) {
    localBranches.value = res.data.map((b) => b.name);
  }
  if (baseBranch.value && !localBranches.value.includes(baseBranch.value)) {
    baseBranch.value = "";
  }
}, { immediate: true });

function buildOverrides() {
  const orig = request.value || {};
  const origIsNew = !orig.existing_session_id;
  const origCreateBranch = !!orig.create_branch;
  return {
    workspace: selectedWorkspace.value !== (orig.workspace || "") ? selectedWorkspace.value : null,
    branch: branch.value !== (orig.branch || "") ? branch.value : null,
    base_branch: baseBranch.value !== (orig.base_branch || "") ? baseBranch.value : null,
    text: text.value !== (orig.text || "") ? text.value : null,
    job: selectedJob.value !== (orig.job || "terminal") ? selectedJob.value : null,
    match: isNewSession.value !== origIsNew ? (isNewSession.value ? "none" : "any") : null,
    session_id: !isNewSession.value && selectedSessionId.value !== (orig.existing_session_id || null) ? selectedSessionId.value : null,
    create_branch: selectedCreateBranch.value !== origCreateBranch ? selectedCreateBranch.value : null,
  };
}

async function run() {
  if (running.value || !itemId) return;
  running.value = true;
  runError.value = "";
  try {
    const ok = await runItem(itemId, buildOverrides());
    // Run 成功後はそのままセッションを見せたいので、一覧へ戻さず Settings ごと閉じる。
    if (ok) emit("modal:close");
  } finally {
    running.value = false;
  }
}

async function discard() {
  if (discarding.value || !itemId) return;
  const label = request.value?.effective_workspace || request.value?.workspace || "";
  if (!await confirm(`Discard dispatch for "${label}"? This cannot be undone.`)) return;
  discarding.value = true;
  try {
    const ok = await rejectItem(itemId);
    if (ok) popView();
  } finally {
    discarding.value = false;
  }
}
</script>

<style scoped>
.ws-settings-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.ws-settings-row-stack .ws-settings-label {
  min-width: 0;
}

.ws-delete-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.ws-delete-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 12px;
  font-size: 13px;
  color: var(--error);
  background: transparent;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  cursor: pointer;
  justify-content: center;
}

.dispatch-run-meta {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 13px;
  padding: 0 4px;
}
.dispatch-run-meta dt {
  color: var(--text-secondary);
}
.dispatch-run-meta dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-all;
}
.dispatch-run-note {
  margin-left: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.dispatch-run-input {
  resize: vertical;
  font-family: monospace;
}
</style>
