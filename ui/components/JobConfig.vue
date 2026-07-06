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
      <div v-else class="ws-settings-row ws-settings-row-stack">
        <span class="ws-settings-label">Command</span>
        <textarea class="form-input job-command-input" v-model="form.command" placeholder="Command to execute (multi-line shell script supported)" autocomplete="off" rows="3" spellcheck="false"></textarea>
        <div class="job-command-hint">
          Use <code v-text="'[[name]]'"></code> to prompt for a value at launch
          (e.g. <code v-text="'claude [[prompt]]'"></code>). Values are quoted automatically.
        </div>
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
        <label class="form-check-label"><input type="checkbox" class="form-checkbox" v-model="form.detached_tab" /> Run detached</label>
      </div>
      <div v-if="form.type !== 'browser'" class="ws-settings-row">
        <span class="ws-settings-label">Timeout (sec)</span>
        <input type="number" class="form-input" style="max-width:120px" v-model.number="form.timeout_sec"
          placeholder="Default (300)" min="1" max="86400" autocomplete="off" />
      </div>
      <div v-if="form.type !== 'browser'" class="ws-settings-row ws-settings-row-stack">
        <div class="phrase-template-row">
          <span class="ws-settings-label">State icons</span>
          <select class="form-input phrase-template-select" @change="applyTemplate($event.target.value); $event.target.value = ''">
            <option value="" disabled>Templates…</option>
            <option v-for="t in phraseTemplates" :key="t.id" :value="t.id">{{ t.label }}</option>
          </select>
        </div>
        <div class="phrase-list">
          <div v-for="(item, i) in form.phrases" :key="i" class="phrase-row">
            <input type="checkbox" class="form-checkbox" v-model="item.enabled" />
            <button
              type="button"
              class="phrase-icon-btn"
              :class="iconClass(item.icon)"
              :data-tooltip="item.icon"
              @click="openPhraseIconPicker(i)"
            >
              <span class="mdi" :class="item.icon" aria-hidden="true"></span>
            </button>
            <input type="text" class="form-input phrase-input" v-model="item.phrase"
              placeholder="phrase" spellcheck="false" autocomplete="off" />
            <button type="button" class="phrase-del" aria-label="Remove phrase"
              @click="removePhrase(i)">
              <span class="mdi mdi-close"></span>
            </button>
          </div>
          <button type="button" class="phrase-add" @click="addPhrase">
            <span class="mdi mdi-plus"></span> Add
          </button>
        </div>
        <div class="job-command-hint">
          Changes the tab icon when a phrase appears on screen (plain substring match).
          Short distinctive phrases work best — long ones may break across wrapped lines.
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

<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmIrreversible } from "../utils/confirm-irreversible.js";
import { renderIconStr } from "../utils/render-icon.js";
import { MSG_SAVE_FAILED, MSG_DELETE_FAILED, MSG_ERROR_OCCURRED } from "../utils/constants.js";
import { EP_COMMON_JOBS, workspaceApiPath } from "../utils/endpoints.js";
import { extractDomain } from "../utils/icon-url.js";
import {
  buildWatchPhraseItems,
  enabledWatchPhrases,
  disabledWatchPhrases,
  WATCH_PHRASE_ICON_OPTIONS,
} from "../utils/agent-state.js";
import { PHRASE_TEMPLATES } from "../utils/phrase-templates.js";

const { modalTitle, viewState, pushView, popView } = useModalView();
const { apiPost, apiPut, apiDelete } = useApi();
const { confirm } = useConfirm();

const workspaceName = viewState.value.workspaceName;
const isCommon = viewState.value.isCommon || false;
const jobEntry = viewState.value.jobEntry;
const initialForm = viewState.value.initialForm;

const DEFAULT_JOB_ICON = "mdi-play-circle-outline";
const DEFAULT_PHRASE_ICON = "mdi-hand-back-right";

const isNew = !jobEntry;

function copyPhrases(phrases) {
  return (phrases || []).map((i) => ({ ...i }));
}

const form = ref(
  initialForm
    ? {
        ...initialForm,
        phrases: copyPhrases(initialForm.phrases),
      }
    : jobEntry
      ? {
          label: jobEntry.job.label || "",
          type: jobEntry.job.type || "command",
          command: jobEntry.job.command || "",
          url: jobEntry.job.url || "",
          icon: jobEntry.job.icon || DEFAULT_JOB_ICON,
          icon_color: jobEntry.job.icon_color || "",
          confirm: jobEntry.job.confirm !== false,
          detached_tab: !!jobEntry.job.detached_tab,
          timeout_sec: jobEntry.job.timeout_sec ?? null,
          phrases: buildWatchPhraseItems(
            jobEntry.job.watch_phrases,
            jobEntry.job.watch_phrases_disabled,
          ),
        }
      : {
          label: "",
          type: "command",
          command: "",
          url: "",
          icon: DEFAULT_JOB_ICON,
          icon_color: "",
          confirm: false,
          detached_tab: false,
          timeout_sec: null,
          phrases: [],
        }
);

const phraseTemplates = PHRASE_TEMPLATES;

function iconClass(icon) {
  if (["mdi-hand-back-right", "mdi-cursor-default-click", "mdi-alert-circle"].includes(icon)) return "agent-state-blocked";
  if (icon === "mdi-arrow-decision") return "agent-state-select";
  if (["mdi-check-circle", "mdi-check-all"].includes(icon)) return "agent-state-done";
  return "agent-state-custom";
}

function openPhraseIconPicker(phraseIndex) {
  const item = form.value.phrases[phraseIndex];
  pushView("PhraseIconPicker", {
    currentIcon: item?.icon || DEFAULT_PHRASE_ICON,
    iconOptions: WATCH_PHRASE_ICON_OPTIONS,
    onReturn: (result, parentEntry) => {
      if (parentEntry) {
        const phrases = copyPhrases(form.value.phrases);
        if (phrases[phraseIndex]) phrases[phraseIndex].icon = result.icon;
        parentEntry.state.initialForm = { ...form.value, phrases };
      }
    },
  });
}

function applyTemplate(id) {
  const tpl = PHRASE_TEMPLATES.find((t) => t.id === id);
  if (!tpl) return;
  form.value.phrases = tpl.phrases.map((p) => ({ ...p, enabled: true }));
}

function addPhrase() {
  form.value.phrases.push({ phrase: "", icon: DEFAULT_PHRASE_ICON, enabled: true });
}

function removePhrase(i) {
  form.value.phrases.splice(i, 1);
}

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
          phrases: copyPhrases(form.value.phrases),
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
  if (f.type === "browser") {
    if (!f.url.trim()) { formError.value = "Please enter a URL"; return; }
  } else {
    if (!f.command.trim()) { formError.value = "Please enter a command"; return; }
  }
  saving.value = true;
  formError.value = "";
  try {
    const baseUrl = isCommon ? EP_COMMON_JOBS : workspaceApiPath(workspaceName, "/jobs");
    const url = isNew ? baseUrl : `${baseUrl}/${encodeURIComponent(jobEntry.name)}`;
    const trimmedUrl = f.url.trim();
    const icon = f.type === "browser"
      ? (trimmedUrl ? `favicon:${extractDomain(trimmedUrl)}` : DEFAULT_JOB_ICON)
      : (f.icon.trim() || DEFAULT_JOB_ICON);
    const timeoutSec = f.type !== "browser" && f.timeout_sec ? Number(f.timeout_sec) : null;
    const body = {
      label: f.label.trim(),
      type: f.type,
      command: f.type === "command" ? f.command.trim() : "",
      url: f.type === "browser" ? trimmedUrl : "",
      icon,
      icon_color: f.type === "browser" ? "" : f.icon_color.trim(),
      confirm: f.type === "browser" ? false : f.confirm,
      detached_tab: f.type === "browser" ? false : f.detached_tab,
      timeout_sec: timeoutSec,
      state_patterns: {},
      disabled_state_patterns: {},
      watch_phrases: f.type === "browser" ? [] : enabledWatchPhrases(f.phrases),
      watch_phrases_disabled: f.type === "browser" ? [] : disabledWatchPhrases(f.phrases),
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
  const baseUrl = isCommon ? EP_COMMON_JOBS : workspaceApiPath(workspaceName, "/jobs");
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

.phrase-template-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.phrase-template-select { max-width: 160px; font-size: 12px; padding: 4px 6px; }

.phrase-list { display: flex; flex-direction: column; gap: 4px; }
.phrase-row { display: flex; align-items: center; gap: 6px; }
.phrase-input { flex: 1; min-width: 0; font-family: ui-monospace, "Menlo", "Consolas", monospace; }
.phrase-del { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 4px; font-size: 16px; line-height: 1; flex-shrink: 0; }
@media (hover: hover) and (pointer: fine) { .phrase-del:hover { color: var(--error); } }
.phrase-add { display: flex; align-items: center; gap: 4px; background: none; border: 1px dashed var(--border); color: var(--text-muted); cursor: pointer; padding: 5px 10px; border-radius: var(--radius); font-size: 12px; margin-top: 2px; }
@media (hover: hover) and (pointer: fine) { .phrase-add:hover { color: var(--text-primary); border-color: var(--text-muted); } }

.phrase-icon-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 3px 6px;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.phrase-icon-btn.agent-state-blocked { color: var(--error); }
.phrase-icon-btn.agent-state-select { color: #f5a623; }
.phrase-icon-btn.agent-state-done { color: var(--success); }
.phrase-icon-btn.agent-state-custom { color: var(--accent); }

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
