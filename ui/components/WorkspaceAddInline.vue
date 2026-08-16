<template>
  <div>
    <div class="ws-add-section-label">
      Add Workspace
      <span class="ws-add-hint">— pick from suggestions or type a path</span>
    </div>
    <div class="ws-add-row">
      <input
        type="text"
        class="form-input ws-add-input"
        v-model="addPath"
        autocomplete="off"
        @focus="onInputFocus"
        @blur="onInputBlur"
        @input="loadSuggest"
        @keydown.enter="doAddExisting"
      />
    </div>
    <div v-if="suggestVisible && suggestEntries.length" class="ws-suggest-list">
      <div class="ws-suggest-base">{{ suggestBase }}</div>
      <div
        v-for="entry in suggestEntries"
        :key="entry.path"
        class="ws-suggest-item"
        :class="{ registered: entry.registered }"
        @mousedown.prevent="onSuggestClick(entry)"
      >
        <span class="ws-suggest-name">{{ entry.name }}</span>
        <span v-if="entry.registered" class="ws-suggest-badge">Registered</span>
      </div>
    </div>
    <div class="ws-settings-row">
      <span class="ws-settings-label">Icon</span>
      <button type="button" class="icon-select-btn" @click="openIconPicker">
        <span class="icon-select-preview">
          <span v-html="renderIconStr(addIcon || 'mdi-console', addIconColor, 18)"></span>
          <span class="icon-select-label">{{ addIcon || 'Default' }}</span>
        </span>
      </button>
    </div>
    <div v-if="addError" class="form-message error">{{ addError }}</div>
    <div v-if="addSuccess" class="form-message success">{{ addSuccess }}</div>
    <button
      type="button"
      class="primary ws-add-submit-btn"
      :disabled="adding"
      @click="doAddExisting"
    >
      <span class="mdi mdi-plus"></span>
      {{ adding ? 'Adding...' : 'Add Workspace' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useApi } from "../composables/useApi.ts";
import { useDirectorySuggest } from "../composables/useDirectorySuggest.ts";
import { useModalView } from "../composables/useModalView.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { EP_WORKSPACES } from "../utils/endpoints.ts";
import { MSG_ERROR_OCCURRED } from "../utils/constants.ts";

const props = defineProps({
  initialPath: { type: String, default: "" },
});

const emit = defineEmits(["added"]);

const { apiPost } = useApi();
const { viewState, pushView } = useModalView();

const addPath = ref(props.initialPath || "");
const addIcon = ref("");
const addIconColor = ref("");
const adding = ref(false);
const addError = ref("");
const addSuccess = ref("");

const {
  suggestBase,
  suggestEntries,
  suggestVisible,
  loadSuggest,
  onInputFocus,
  onInputBlur,
  onSuggestClick,
} = useDirectorySuggest(addPath);

function openIconPicker() {
  pushView!("IconPicker", {
    currentIcon: addIcon.value,
    currentColor: addIconColor.value,
    onReturn: (result: { icon: string, color: string }, parentEntry?: { state: Record<string, any> }) => {
      if (parentEntry) {
        parentEntry.state.pendingIcon = result.icon;
        parentEntry.state.pendingColor = result.color;
      }
    },
  });
}

async function doAddExisting() {
  if (!addPath.value.trim()) { addError.value = "Please enter a path"; return; }
  adding.value = true;
  addError.value = "";
  addSuccess.value = "";
  try {
    const { ok, data } = await apiPost(EP_WORKSPACES, {
      path: addPath.value.trim(),
      icon: addIcon.value || null,
      icon_color: addIconColor.value || null,
    });
    if (!ok) {
      addError.value = data?.detail || "Failed to add";
    } else {
      addSuccess.value = `${data?.name || "directory"} added`;
      addPath.value = "";
      addIcon.value = "";
      addIconColor.value = "";
      emit("added", data?.name || null);
      loadSuggest();
    }
  } catch (e) {
    addError.value = e.message || MSG_ERROR_OCCURRED;
  } finally {
    adding.value = false;
  }
}

onMounted(() => {
  if (viewState!.value && "pendingIcon" in viewState!.value) {
    addIcon.value = viewState!.value.pendingIcon;
    addIconColor.value = viewState!.value.pendingColor ?? "";
    delete viewState!.value.pendingIcon;
    delete viewState!.value.pendingColor;
  }
  loadSuggest();
});
</script>

<style>
@import "../styles/form-message.css";
</style>

<style scoped>
.ws-add-section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 4px 0 8px;
}

.ws-add-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 4px;
}

.ws-add-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 0 4px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}

.ws-add-input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}

.ws-add-submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
}

.ws-suggest-list {
  margin: 4px 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  max-height: 140px;
  overflow-y: auto;
}

.ws-suggest-base {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
  border-bottom: 1px solid var(--border);
  background: var(--bg-tertiary);
  word-break: break-all;
}

.ws-suggest-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.ws-suggest-item:last-child { border-bottom: none; }

.ws-suggest-item.registered {
  opacity: 0.4;
  cursor: default;
}

.ws-suggest-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-suggest-badge {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1px 6px;
}
</style>
