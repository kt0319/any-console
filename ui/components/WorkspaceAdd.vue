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
        <button type="button" class="primary" :disabled="cloning" @click="doClone">
          {{ cloning ? 'クローン中...' : 'クローン' }}
        </button>
      </div>
      <div v-if="cloneError" class="clone-repo-error">{{ cloneError }}</div>
      <div v-if="cloneSuccess" class="clone-repo-success" style="color:var(--success);padding:8px;text-align:center">{{ cloneSuccess }}</div>
    </div>

  </div>
</template>

<script setup>
import { ref, inject, onMounted } from "vue";
import { useAuthStore } from "../stores/auth.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "ワークスペース追加";

const auth = useAuthStore();

const cloneUrl = ref("");
const cloneName = ref("");
const cloning = ref(false);
const cloneError = ref("");
const cloneSuccess = ref("");

const repos = ref([]);
const loadingRepos = ref(false);
const reposError = ref("");

async function doClone() {
  if (!cloneUrl.value.trim()) { cloneError.value = "URLを入力してください"; return; }
  cloning.value = true;
  cloneError.value = "";
  cloneSuccess.value = "";
  try {
    const res = await auth.apiFetch("/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: cloneUrl.value.trim(), name: cloneName.value.trim() || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      cloneError.value = data.detail || "クローンに失敗しました";
    } else {
      cloneSuccess.value = `${data.name || "リポジトリ"} をクローンしました`;
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
  cloneName.value = "";
}

async function loadRepos() {
  loadingRepos.value = true;
  reposError.value = "";
  try {
    const res = await auth.apiFetch("/github/repos");
    if (!res || !res.ok) {
      reposError.value = "リポジトリ一覧を取得できませんでした";
      return;
    }
    repos.value = await res.json();
  } catch (e) {
    reposError.value = e.message || "取得に失敗しました";
  } finally {
    loadingRepos.value = false;
  }
}

onMounted(loadRepos);
</script>
