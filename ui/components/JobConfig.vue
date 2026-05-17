<template>
  <div class="modal-scroll-body">
    <div class="ws-settings-section">
      <div class="ws-settings-row">
        <span class="ws-settings-label">Label</span>
        <input type="text" class="form-input" v-model="form.label" placeholder="Display name" autocomplete="off" />
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Type</span>
        <label class="form-check-label"><input type="radio" v-model="form.type" value="command" /> Command</label>
        <label class="form-check-label"><input type="radio" v-model="form.type" value="browser" /> Browser</label>
      </div>
      <div v-if="form.type === 'browser'" class="ws-settings-row">
        <span class="ws-settings-label">URL</span>
        <input type="text" class="form-input" v-model="form.url" placeholder="https://example.com" autocomplete="off" />
      </div>
      <div v-else class="ws-settings-row">
        <span class="ws-settings-label">Command</span>
        <input type="text" class="form-input" v-model="form.command" placeholder="Command to execute" autocomplete="off" />
      </div>
      <div v-if="form.type !== 'browser'" class="ws-settings-row">
        <span class="ws-settings-label">Icon</span>
        <button type="button" class="icon-select-btn" @click="openIconPicker">
          <span class="icon-select-preview">
            <span v-html="renderIconStr(form.icon || 'mdi-play', form.icon_color, 18)"></span>
            <span class="icon-select-label">{{ form.icon || 'Default' }}</span>
          </span>
        </button>
      </div>
      <div v-if="form.type !== 'browser'" class="ws-settings-row" style="gap:8px">
        <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="form.confirm" /> Confirm dialog</label>
        <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="form.hidden_tab" /> Run in hidden tab</label>
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
import { EP_COMMON_JOBS } from "../utils/endpoints.js";

const { modalTitle, viewState, pushView, popView } = useModalView();
const { apiPost, apiPut } = useApi();

const workspaceName = viewState.value.workspaceName;
const isCommon = viewState.value.isCommon || false;
const jobEntry = viewState.value.jobEntry;
const initialForm = viewState.value.initialForm;

const DEFAULT_JOB_ICON = "mdi-play-circle-outline";

const isNew = !jobEntry;
const form = ref(
  initialForm
    ? { ...initialForm }
    : jobEntry
      ? {
          label: jobEntry.job.label || "",
          type: jobEntry.job.type || "command",
          command: jobEntry.job.command || "",
          url: jobEntry.job.url || "",
          icon: jobEntry.job.icon || DEFAULT_JOB_ICON,
          icon_color: jobEntry.job.icon_color || "",
          confirm: jobEntry.job.confirm !== false,
          hidden_tab: !!jobEntry.job.hidden_tab,
        }
      : {
          label: "",
          type: "command",
          command: "",
          url: "",
          icon: DEFAULT_JOB_ICON,
          icon_color: "",
          confirm: false,
          hidden_tab: false,
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

function extractDomain(text) {
  try {
    if (text.startsWith("http://") || text.startsWith("https://")) return new URL(text).hostname;
    return text.split("/")[0];
  } catch {
    return text;
  }
}

async function saveJob() {
  const f = form.value;
  if (f.type === "browser") {
    if (!f.url.trim()) { formError.value = "Please enter a URL"; return; }
  } else {
    if (!f.command.trim()) { formError.value = "Please enter a command"; return; }
  }
  saving.value = true;
  formError.value = "";
  try {
    const baseUrl = isCommon ? EP_COMMON_JOBS : `/workspaces/${encodeURIComponent(workspaceName)}/jobs`;
    const url = isNew ? baseUrl : `${baseUrl}/${encodeURIComponent(jobEntry.name)}`;
    const trimmedUrl = f.url.trim();
    const icon = f.type === "browser"
      ? (trimmedUrl ? `favicon:${extractDomain(trimmedUrl)}` : DEFAULT_JOB_ICON)
      : (f.icon.trim() || DEFAULT_JOB_ICON);
    const body = {
      label: f.label.trim(),
      type: f.type,
      command: f.type === "command" ? f.command.trim() : "",
      url: f.type === "browser" ? trimmedUrl : "",
      icon,
      icon_color: f.type === "browser" ? "" : f.icon_color.trim(),
      confirm: f.type === "browser" ? false : f.confirm,
      hidden_tab: f.type === "browser" ? false : f.hidden_tab,
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
