<template>
  <div class="modal-scroll-body">
    <div class="ws-settings-section">
      <div v-if="isNew" class="ws-settings-row">
        <span class="ws-settings-label">Scope</span>
        <select v-model="scopeSelection" class="form-input">
          <option value="">(Common job)</option>
          <option v-for="w in workspaceOptions" :key="w.name" :value="w.name">{{ w.name }}</option>
        </select>
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Label</span>
        <input type="text" class="form-input" v-model="form.label" placeholder="Display name" autocomplete="off" />
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Icon</span>
        <button type="button" class="icon-select-btn" @click="openIconPicker">
          <span class="icon-select-preview">
            <span v-html="renderIconStr(form.icon || 'mdi-play', form.icon_color, 18)"></span>
            <span class="icon-select-label">{{ form.icon || 'Default' }}</span>
          </span>
        </button>
      </div>
      <div class="ws-settings-row ws-settings-row-stack">
        <span class="ws-settings-label">Command</span>
        <textarea class="form-input job-command-input" v-model="form.command" placeholder="Command to execute (multi-line shell script supported)" autocomplete="off" rows="3" spellcheck="false"></textarea>
        <div class="job-command-hint">
          Use <code v-text="'[[name]]'"></code> to prompt for a value at launch
          (e.g. <code v-text="'claude [[prompt]]'"></code>). Values are quoted automatically.
        </div>
      </div>
      <div class="job-section-divider"></div>
      <div class="ws-settings-row" style="gap:8px">
        <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="form.confirm" /> Confirm dialog</label>
        <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="form.detached" /> Run detached</label>
      </div>
      <div class="ws-settings-row ws-settings-row-stack">
        <span class="ws-settings-label">Notify phrase <span class="job-label-note">(PWA only)</span></span>
        <input type="text" class="form-input" v-model="form.notify_phrase"
          placeholder="Phrase to watch in output" spellcheck="false" autocomplete="off" />
        <div class="notify-phrase-hint">
          Push notification when this phrase appears in output
          (delay configurable in Notifications settings).
          e.g. {{ NOTIFY_EXAMPLES.join(", ") }}
        </div>
      </div>
      <div class="ws-settings-row" style="gap:8px">
        <button type="button" class="primary" :disabled="saving" @click="saveJob">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
      <div v-if="formError" class="job-config-error">{{ formError }}</div>
      <div v-if="!isNew" class="ws-settings-row ws-delete-row">
        <button type="button" class="ws-delete-btn" @click="deleteJob">
          <span class="mdi mdi-delete-outline"></span>
          Delete Job
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useApi } from "../composables/useApi.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { confirmIrreversible } from "../utils/confirm-irreversible.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { MSG_SAVE_FAILED, MSG_DELETE_FAILED, MSG_ERROR_OCCURRED } from "../utils/constants.ts";
import { EP_COMMON_JOBS, workspaceApiPath } from "../utils/endpoints.ts";

// useModalView の各値は inject（default null はテスト用）。実行時は常に
// provide されるため non-null で扱う。
const modalView = useModalView();
const modalTitle = modalView.modalTitle!;
const viewState = modalView.viewState!;
const pushView = modalView.pushView!;
const popView = modalView.popView!;
const { apiPost, apiPut, apiDelete } = useApi();
const { confirm } = useConfirm();
const workspaceStore = useWorkspaceStore();

const jobEntry = viewState.value.jobEntry;
// 新規作成時だけCommon/Workspaceを選べる（既存ジョブのスコープは作成後に
// 変更しない。別コレクションへの移動になり削除+作り直しに近くなるため）。
const isCommon = ref(!!viewState.value.isCommon);
// Workspace選択も新規作成時だけ変更可能（開いた行のワークスペースを初期値にする）。
const workspaceName = ref(viewState.value.workspaceName || "");
const workspaceOptions = computed(() => workspaceStore.allWorkspaces.filter((w) => w.exists !== false));
// Scope(Common/Workspace)とWorkspace選択を1つのselectに統合する。空文字列は
// 「Common job」を表す（Commonの選び忘れでWorkspaceに紐づくミスを防ぐため、
// ラジオ+条件表示のselectをやめて単一のselectに一本化した）。
const scopeSelection = computed({
  get: () => (isCommon.value ? "" : workspaceName.value),
  set: (value) => {
    isCommon.value = value === "";
    if (value !== "") workspaceName.value = value;
  },
});
const initialForm = viewState.value.initialForm;

const DEFAULT_JOB_ICON = "mdi-play-circle-outline";

const NOTIFY_EXAMPLES = ["Do you want to proceed?", "esc to interrupt", "Press Enter", "1. Yes"];

const isNew = !jobEntry;

const form = ref(
  initialForm
    ? { ...initialForm }
    : jobEntry
      ? {
          label: jobEntry.job.label || "",
          command: jobEntry.job.command || "",
          icon: jobEntry.job.icon || DEFAULT_JOB_ICON,
          icon_color: jobEntry.job.icon_color || "",
          confirm: jobEntry.job.confirm !== false,
          detached: !!jobEntry.job.detached,
          notify_phrase: jobEntry.job.notify_phrase || "",
        }
      : {
          label: "",
          command: "",
          icon: DEFAULT_JOB_ICON,
          icon_color: "",
          confirm: false,
          detached: false,
          notify_phrase: "",
        }
);

const saving = ref(false);
const formError = ref("");

function openIconPicker() {
  pushView("IconPicker", {
    currentIcon: form.value.icon,
    currentColor: form.value.icon_color,
    onReturn: (result, parentEntry) => {
      if (parentEntry) {
        parentEntry.state.initialForm = {
          ...form.value,
          icon: result.icon,
          icon_color: result.color,
        };
      }
    },
  });
}

onMounted(() => {
  modalTitle.value = isNew ? "Add Job" : "Edit Job";
});

async function saveJob() {
  const f = form.value;
  if (!f.command.trim()) { formError.value = "Please enter a command"; return; }
  saving.value = true;
  formError.value = "";
  try {
    const baseUrl = isCommon.value ? EP_COMMON_JOBS : workspaceApiPath(workspaceName.value, "/jobs");
    const url = isNew ? baseUrl : `${baseUrl}/${encodeURIComponent(jobEntry.name)}`;
    const body = {
      label: f.label.trim(),
      command: f.command.trim(),
      icon: f.icon.trim() || DEFAULT_JOB_ICON,
      icon_color: f.icon_color.trim(),
      confirm: f.confirm,
      detached: f.detached,
      notify_phrase: f.notify_phrase.trim(),
    };
    const { ok, data } = isNew ? await apiPost(url, body) : await apiPut(url, body);
    if (!ok) {
      formError.value = data?.detail || MSG_SAVE_FAILED;
    } else {
      popView(true);
    }
  } catch (e) {
    formError.value = e.message || MSG_ERROR_OCCURRED;
  } finally {
    saving.value = false;
  }
}

async function deleteJob() {
  if (isNew || !jobEntry) return;
  const label = jobEntry.job.label || jobEntry.name;
  if (!await confirmIrreversible(confirm, `Delete job "${label}"?`)) return;
  const baseUrl = isCommon.value ? EP_COMMON_JOBS : workspaceApiPath(workspaceName.value, "/jobs");
  const url = `${baseUrl}/${encodeURIComponent(jobEntry.name)}`;
  const { ok, data } = await apiDelete(url, { errorMessage: MSG_DELETE_FAILED });
  if (ok) {
    popView(true);
  } else if (data?.detail) {
    formError.value = data.detail;
  }
}
</script>

<style scoped>
.ws-delete-row {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.ws-settings-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.ws-settings-row-stack .ws-settings-label {
  min-width: 0;
}

.job-command-input {
  width: 100%;
  font-family: ui-monospace, "Menlo", "Consolas", monospace;
  resize: vertical;
  min-height: 64px;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}

.job-command-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.4;
}

.job-command-hint code {
  font-family: ui-monospace, "Menlo", "Consolas", monospace;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-tertiary);
}


.job-label-note {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}

.job-section-divider {
  border-top: 1px solid var(--border);
  margin: 4px 0;
}

.notify-phrase-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.6;
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
</style>
