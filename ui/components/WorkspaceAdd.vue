<template>
  <div class="modal-scroll-body">
    <div class="clone-tab-content">
      <div class="settings-section-label">GitHub Repositories</div>
      <div v-if="isLoadingRepos" class="clone-repo-loading">Loading...</div>
      <div v-else-if="reposError" class="clone-repo-error">{{ reposError }}</div>
      <div v-else class="clone-repo-list">
        <div
          v-for="repo in repos"
          :key="repo.nameWithOwner"
          class="clone-repo-item"
          :class="{ selected: cloneUrl === repoCloneUrl(repo) }"
          @click="selectRepo(repo)"
        >
          <div class="clone-repo-name">{{ repo.nameWithOwner }}</div>
          <div v-if="repo.description" class="clone-repo-desc">{{ repo.description }}</div>
        </div>
        <div v-if="repos.length === 0" class="clone-repo-empty">No repositories found</div>
      </div>
    </div>

    <div class="clone-tab-content">
      <div class="settings-section-label">Git Clone</div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="cloneUrl"
          placeholder="Repository URL (GitHub / SSH)"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="cloneName"
          placeholder="Directory name (auto if empty)"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="cloneBaseDir"
          placeholder="Clone directory"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <button type="button" class="primary" :disabled="cloning" @click="doClone">
          {{ cloning ? 'Cloning...' : 'Clone' }}
        </button>
      </div>
      <div v-if="cloneError" class="clone-repo-error">{{ cloneError }}</div>
      <div v-if="cloneSuccess" class="clone-repo-success">{{ cloneSuccess }}</div>
    </div>

    <div class="clone-tab-content">
      <div class="settings-section-label">Add Existing Directory</div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="addPath"
          placeholder="Full path (e.g. /home/user/projects/myapp)"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <button type="button" class="primary" :disabled="adding" @click="doAddExisting">
          {{ adding ? 'Adding...' : 'Add' }}
        </button>
      </div>
      <div v-if="addError" class="clone-repo-error">{{ addError }}</div>
      <div v-if="addSuccess" class="clone-repo-success">{{ addSuccess }}</div>
    </div>

  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { MSG_ERROR_OCCURRED } from "../utils/constants.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Add Workspace";

const workspaceStore = useWorkspaceStore();
const { apiGet, apiPost, apiCommand } = useApi();

let defaultWorkDir = "";
const cloneUrl = ref("");
const cloneName = ref("");
const cloneBaseDir = ref("");
const cloning = ref(false);
const cloneError = ref("");
const cloneSuccess = ref("");

const addPath = ref("");
const adding = ref(false);
const addError = ref("");
const addSuccess = ref("");

const repos = ref([]);
const isLoadingRepos = ref(false);
const reposError = ref("");

async function doAddExisting() {
  if (!addPath.value.trim()) { addError.value = "Please enter a path"; return; }
  adding.value = true;
  addError.value = "";
  addSuccess.value = "";
  try {
    const { ok, data } = await apiPost("/workspaces", { path: addPath.value.trim() });
    if (!ok) {
      addError.value = data?.detail || "Failed to add";
    } else {
      addSuccess.value = `${data?.name || "directory"} added`;
      addPath.value = "";
      workspaceStore.fetchWorkspaces();
    }
  } catch (e) {
    addError.value = e.message || MSG_ERROR_OCCURRED;
  } finally {
    adding.value = false;
  }
}

async function doClone() {
  if (!cloneUrl.value.trim()) { cloneError.value = "Please enter a URL"; return; }
  cloning.value = true;
  cloneError.value = "";
  cloneSuccess.value = "";
  try {
    const { ok, data } = await apiCommand("/workspaces", {
      url: cloneUrl.value.trim(),
      name: cloneName.value.trim() || null,
      base_dir: cloneBaseDir.value.trim() || null,
    });
    if (!ok) {
      cloneError.value = data?.detail || data?.message || "Clone failed";
    } else {
      cloneSuccess.value = `${data?.name || "repository"} cloned`;
      cloneUrl.value = "";
      cloneName.value = "";
      workspaceStore.fetchWorkspaces();
    }
  } catch (e) {
    cloneError.value = e.message || MSG_ERROR_OCCURRED;
  } finally {
    cloning.value = false;
  }
}

function repoCloneUrl(repo) {
  const nwo = repo.nameWithOwner || "";
  return `git@github.com:${nwo}.git`;
}

function selectRepo(repo) {
  cloneUrl.value = repoCloneUrl(repo);
  const name = (repo.nameWithOwner || "").split("/").pop();
  cloneName.value = name;
  if (!cloneBaseDir.value && defaultWorkDir) {
    cloneBaseDir.value = defaultWorkDir;
  }
}

async function loadRepos() {
  isLoadingRepos.value = true;
  reposError.value = "";
  try {
    const { ok, data } = await apiGet("/github/repos");
    if (!ok) {
      reposError.value = data?.detail || "Failed to fetch repository list";
      return;
    }
    repos.value = data;
  } catch (e) {
    reposError.value = e.message || "Failed to fetch";
  } finally {
    isLoadingRepos.value = false;
  }
}

async function loadWorkDir() {
  try {
    const { ok, data } = await apiGet("/system/info");
    if (ok) {
      defaultWorkDir = data.work_dir || "";
      cloneBaseDir.value = defaultWorkDir;
    }
  } catch { /* ignore */ }
}

onMounted(() => { loadRepos(); loadWorkDir(); });
</script>

<style scoped>
.settings-section-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.clone-tab-content {
  margin-bottom: 12px;
}

.clone-repo-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
}

.clone-repo-item {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
}

.clone-repo-item:last-child {
  border-bottom: none;
}

.clone-repo-item.selected {
  background: var(--accent-bg-20);
  border-left: 3px solid var(--accent);
}

.clone-repo-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.clone-repo-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.clone-repo-success {
  color: var(--success);
  padding: 8px;
  text-align: center;
}
</style>
