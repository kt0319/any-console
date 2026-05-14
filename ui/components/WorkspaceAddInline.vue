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
      <button
        type="button"
        class="ws-add-btn"
        :disabled="adding"
        :title="adding ? 'Adding...' : 'Add workspace'"
        @click="doAddExisting"
      >
        <span class="mdi mdi-plus"></span>
      </button>
    </div>
    <div v-if="addError" class="form-message error">{{ addError }}</div>
    <div v-if="addSuccess" class="form-message success">{{ addSuccess }}</div>
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
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useDirectorySuggest } from "../composables/useDirectorySuggest.js";
import { EP_WORKSPACES } from "../utils/endpoints.js";
import { MSG_ERROR_OCCURRED } from "../utils/constants.js";

const emit = defineEmits(["added"]);

const { apiPost } = useApi();

const addPath = ref("");
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

async function doAddExisting() {
  if (!addPath.value.trim()) { addError.value = "Please enter a path"; return; }
  adding.value = true;
  addError.value = "";
  addSuccess.value = "";
  try {
    const { ok, data } = await apiPost(EP_WORKSPACES, { path: addPath.value.trim() });
    if (!ok) {
      addError.value = data?.detail || "Failed to add";
    } else {
      addSuccess.value = `${data?.name || "directory"} added`;
      addPath.value = "";
      emit("added");
      loadSuggest();
    }
  } catch (e) {
    addError.value = e.message || MSG_ERROR_OCCURRED;
  } finally {
    adding.value = false;
  }
}

onMounted(() => {
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

.ws-add-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.ws-add-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
