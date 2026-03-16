<template>
  <div class="modal-scroll-body">
    <div class="clone-tab-content">
      <div class="settings-section-label">GitHub リポジトリ</div>
      <div v-if="loadingRepos" class="clone-repo-loading">読み込み中...</div>
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
        <div v-if="repos.length === 0" class="clone-repo-empty">リポジトリが見つかりません</div>
      </div>
    </div>

    <div class="clone-tab-content">
      <div class="settings-section-label">Git Clone</div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="cloneUrl"
          placeholder="リポジトリURL（GitHub / SSH）"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="cloneName"
          placeholder="ディレクトリ名（空欄で自動）"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="cloneBaseDir"
          placeholder="クローン先ディレクトリ"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <button type="button" class="primary" :disabled="cloning" @click="doClone">
          {{ cloning ? 'クローン中...' : 'クローン' }}
        </button>
      </div>
      <div v-if="cloneError" class="clone-repo-error">{{ cloneError }}</div>
      <div v-if="cloneSuccess" class="clone-repo-success">{{ cloneSuccess }}</div>
    </div>

    <div class="clone-tab-content">
      <div class="settings-section-label">既存ディレクトリを追加</div>
      <div class="clone-form-row">
        <input
          type="text"
          class="form-input"
          v-model="addPath"
          placeholder="フルパス（例: /home/user/projects/myapp）"
          autocomplete="off"
        />
      </div>
      <div class="clone-form-row">
        <button type="button" class="primary" :disabled="adding" @click="doAddExisting">
          {{ adding ? '追加中...' : '追加' }}
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

const modalTitle = inject("modalTitle");
modalTitle.value = "ワークスペース追加";

const { apiGet, apiPost } = useApi();

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
const loadingRepos = ref(false);
const reposError = ref("");

async function doAddExisting() {
  if (!addPath.value.trim()) { addError.value = "パスを入力してください"; return; }
  adding.value = true;
  addError.value = "";
  addSuccess.value = "";
  try {
    const { ok, data } = await apiPost("/workspaces", { path: addPath.value.trim() });
    if (!ok) {
      addError.value = data?.detail || "追加に失敗しました";
    } else {
      addSuccess.value = `${data?.name || "ディレクトリ"} を追加しました`;
      addPath.value = "";
    }
  } catch (e) {
    addError.value = e.message || "エラーが発生しました";
  } finally {
    adding.value = false;
  }
}

async function doClone() {
  if (!cloneUrl.value.trim()) { cloneError.value = "URLを入力してください"; return; }
  cloning.value = true;
  cloneError.value = "";
  cloneSuccess.value = "";
  try {
    const { ok, data } = await apiPost("/workspaces", {
      url: cloneUrl.value.trim(),
      name: cloneName.value.trim() || null,
      base_dir: cloneBaseDir.value.trim() || null,
    });
    if (!ok) {
      cloneError.value = data?.detail || "クローンに失敗しました";
    } else {
      cloneSuccess.value = `${data?.name || "リポジトリ"} をクローンしました`;
      cloneUrl.value = "";
      cloneName.value = "";
    }
  } catch (e) {
    cloneError.value = e.message || "エラーが発生しました";
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
  loadingRepos.value = true;
  reposError.value = "";
  try {
    const { ok, data } = await apiGet("/github/repos");
    if (!ok) {
      reposError.value = "リポジトリ一覧を取得できませんでした";
      return;
    }
    repos.value = data;
  } catch (e) {
    reposError.value = e.message || "取得に失敗しました";
  } finally {
    loadingRepos.value = false;
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

.clone-repo-loading,
.clone-repo-empty,
.clone-repo-error {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.clone-repo-error {
  color: var(--error);
}

.clone-repo-success {
  color: var(--success);
  padding: 8px;
  text-align: center;
}
</style>
