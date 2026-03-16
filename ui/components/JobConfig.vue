<template>
  <div class="modal-scroll-body">
    <div class="ws-settings-section">
      <div class="ws-settings-row">
        <span class="ws-settings-label">ラベル</span>
        <input type="text" class="form-input" v-model="form.label" placeholder="表示名" autocomplete="off" />
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">コマンド</span>
        <input type="text" class="form-input" v-model="form.command" placeholder="実行コマンド" autocomplete="off" />
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">アイコン</span>
        <button type="button" class="icon-select-btn" @click="openIconPicker">
          <span class="icon-select-preview">
            <span v-html="renderIconStr(form.icon || 'mdi-play', form.icon_color, 18)"></span>
            <span class="icon-select-label">{{ form.icon || 'デフォルト' }}</span>
          </span>
        </button>
      </div>
      <div class="ws-settings-row" style="gap:8px">
        <label class="form-check-label"><input type="checkbox" v-model="form.confirm" /> 確認ダイアログ</label>
        <label class="form-check-label"><input type="checkbox" v-model="form.terminal" /> ターミナルで実行</label>
      </div>
      <div class="ws-settings-row" style="gap:8px">
        <button type="button" class="primary" :disabled="saving" @click="saveJob">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
      <div v-if="formError" class="job-config-error">{{ formError }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { renderIconStr } from "../utils/render-icon.js";

const { modalTitle, viewState, pushView, popView } = useModalView();
const { apiPost, apiPut } = useApi();

const workspaceName = viewState.value.workspaceName;
const jobEntry = viewState.value.jobEntry;
const initialForm = viewState.value.initialForm;

const isNew = !jobEntry;
const form = ref(
  initialForm
    ? { ...initialForm }
    : jobEntry
      ? {
          label: jobEntry.job.label || "",
          command: jobEntry.job.command || "",
          icon: jobEntry.job.icon || "",
          icon_color: jobEntry.job.icon_color || "",
          confirm: jobEntry.job.confirm !== false,
          terminal: jobEntry.job.terminal !== false,
        }
      : {
          label: "",
          command: "",
          icon: "",
          icon_color: "",
          confirm: false,
          terminal: true,
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
        parentEntry.state.initialForm = { ...form.value, icon: result.icon, icon_color: result.color };
      }
    },
  });
}

onMounted(() => {
  modalTitle.value = isNew ? "ジョブ追加" : "ジョブ編集";
});

async function saveJob() {
  const f = form.value;
  if (!f.command.trim()) { formError.value = "コマンドを入力してください"; return; }
  saving.value = true;
  formError.value = "";
  try {
    const url = isNew
      ? `/workspaces/${encodeURIComponent(workspaceName)}/jobs`
      : `/workspaces/${encodeURIComponent(workspaceName)}/jobs/${encodeURIComponent(jobEntry.name)}`;
    const body = {
      label: f.label.trim(),
      command: f.command.trim(),
      icon: f.icon.trim(),
      icon_color: f.icon_color.trim(),
      confirm: f.confirm,
      terminal: f.terminal,
    };
    const { ok, data } = isNew ? await apiPost(url, body) : await apiPut(url, body);
    if (!ok) {
      formError.value = data?.detail || "保存に失敗しました";
    } else {
      popView();
    }
  } catch (e) {
    formError.value = e.message || "エラーが発生しました";
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.ws-settings-section {
  padding: 8px 0;
}

.ws-settings-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}

.ws-settings-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
  min-width: 48px;
}

.form-check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.form-check-label input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border: 2px solid var(--text-muted);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
}

.form-check-label input[type="checkbox"]:checked {
  border-color: var(--accent);
  background: var(--accent);
}

.form-check-label input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid var(--bg-primary);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.icon-select-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 40px;
  font-size: 13px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.icon-select-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.icon-select-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

.job-config-error {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--error);
}
</style>
