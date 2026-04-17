<template>
  <div class="modal-scroll-body">
    <div class="ws-settings-section">
      <div class="ws-settings-row">
        <span class="ws-settings-label">Label</span>
        <input type="text" class="form-input" v-model="form.label" placeholder="Display name" autocomplete="off" />
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Command</span>
        <input type="text" class="form-input" v-model="form.command" placeholder="Command to execute" autocomplete="off" />
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
      <div class="ws-settings-row" style="gap:8px">
        <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="form.confirm" /> Confirm dialog</label>
        <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="form.terminal" /> Run in terminal</label>
      </div>
      <div class="ws-settings-row" style="gap:8px">
        <button type="button" class="primary" :disabled="saving" @click="saveJob">
          {{ saving ? 'Saving...' : 'Save' }}
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
import { MSG_SAVE_FAILED, MSG_ERROR_OCCURRED } from "../utils/constants.js";

const { modalTitle, viewState, pushView, popView } = useModalView();
const { apiPost, apiPut } = useApi();

const workspaceName = viewState.value.workspaceName;
const isGlobal = viewState.value.isGlobal || false;
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
  modalTitle.value = isNew ? "Add Job" : "Edit Job";
});

async function saveJob() {
  const f = form.value;
  if (!f.command.trim()) { formError.value = "Please enter a command"; return; }
  saving.value = true;
  formError.value = "";
  try {
    const baseUrl = isGlobal ? "/global/jobs" : `/workspaces/${encodeURIComponent(workspaceName)}/jobs`;
    const url = isNew ? baseUrl : `${baseUrl}/${encodeURIComponent(jobEntry.name)}`;
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
</script>

<style scoped>
</style>
