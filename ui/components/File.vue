<template>
  <ModalBase ref="modal" modal-id="file-modal" :title="modalTitle" :back="showBack" @back="goBack" @close="close">
    <template #actions>
      <button
        v-for="tab in panes"
        :key="tab.key"
        type="button"
        :class="['modal-tab-btn', { active: activePane === tab.key }]"
        @click="switchPane(tab.key)"
      >{{ tab.label }}</button>
    </template>

    <div class="file-modal-content">
      <div v-show="activePane === 'history'" class="file-modal-pane">
        <GitHistory ref="gitHistory" />
      </div>
      <div v-show="activePane === 'files'" class="file-modal-pane file-modal-pane-split">
        <GitFiles ref="gitFiles" />
        <DiffViewer :file="selectedDiffFile" :message="diffMessage" />
      </div>
      <div v-show="activePane === 'browser'" class="file-modal-pane">
        <FileBrowser ref="fileBrowser" />
      </div>
      <div v-show="activePane === 'branch'" class="file-modal-pane">
        <GitBranch ref="gitBranch" />
      </div>
      <div v-show="activePane === 'stash'" class="file-modal-pane">
        <GitStash ref="gitStash" />
      </div>
      <div v-show="activePane === 'github'" class="file-modal-pane">
        <GitGitHub ref="gitGitHub" />
      </div>

      <CommitForm ref="commitForm" />
    </div>
  </ModalBase>
</template>

<script setup>
import { ref, computed } from "vue";
import ModalBase from "./ModalBase.vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitFiles from "./GitFiles.vue";
import GitBranch from "./GitBranch.vue";
import GitStash from "./GitStash.vue";
import GitGitHub from "./GitGitHub.vue";
import DiffViewer from "./DiffViewer.vue";
import CommitForm from "./CommitForm.vue";
import { on, emit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";

const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const modal = ref(null);
const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitFiles = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const gitGitHub = ref(null);
const commitForm = ref(null);

const activePane = ref("history");
const selectedDiffFile = ref("");
const diffMessage = ref("");
const diffPaneTitle = ref("未コミットの変更");
const commitViewMessage = ref("");
let loadedWorkspace = null;

const PANES = [
  { key: "history", label: "履歴" },
  { key: "browser", label: "ファイル" },
  { key: "files", label: "変更" },
  { key: "branch", label: "ブランチ" },
  { key: "stash", label: "Stash" },
  { key: "github", label: "GitHub" },
];

const panes = ref(PANES);

const showBack = ref(true);

const modalTitle = computed(() => {
  if (commitViewMessage.value) return commitViewMessage.value;
  const pane = PANES.find((p) => p.key === activePane.value);
  if (activePane.value === "files") return diffPaneTitle.value;
  return pane ? pane.label : "Git";
});

function goBack() {
  if (commitViewMessage.value) {
    commitViewMessage.value = "";
    activePane.value = "history";
    diffPaneTitle.value = "未コミットの変更";
    selectedDiffFile.value = "";
    diffMessage.value = "";
  } else {
    close();
    emit("workspace:openModal");
  }
}

async function open(options) {
  options = options || {};
  activePane.value = options.pane || "history";
  selectedDiffFile.value = "";
  diffMessage.value = "";
  diffPaneTitle.value = "未コミットの変更";
  commitViewMessage.value = "";
  modal.value?.open();

  const workspace = workspaceStore.selectedWorkspace;
  if (workspace !== loadedWorkspace) {
    loadedWorkspace = workspace;
    await gitHistory.value?.load();
  }

  if (activePane.value === "files") {
    await gitFiles.value?.loadWorkingTreeDiff();
  }
}

function close() {
  modal.value?.close();
  loadedWorkspace = null;
  emit("git:modalClosed");
}

function switchPane(key) {
  activePane.value = key;
  commitViewMessage.value = "";
  if (key === "history") {
    gitHistory.value?.reload();
  } else if (key === "browser") {
    fileBrowser.value?.load();
  } else if (key === "files") {
    gitFiles.value?.loadWorkingTreeDiff();
  } else if (key === "branch") {
    gitBranch.value?.load();
    gitBranch.value?.backgroundFetch();
  } else if (key === "stash") {
    gitStash.value?.load();
  } else if (key === "github") {
    gitGitHub.value?.load();
  }
}

function showCommitDiff(hash, message) {
  activePane.value = "files";
  commitViewMessage.value = message || `コミット ${hash.slice(0, 8)}`;
  diffPaneTitle.value = `コミット ${hash.slice(0, 8)}`;
  gitFiles.value?.loadCommitDiff(hash);
  selectedDiffFile.value = "";
  diffMessage.value = "";
}

on("git:selectCommit", ({ hash, message }) => {
  showCommitDiff(hash, message);
});

on("git:selectDiffFile", ({ path }) => {
  selectedDiffFile.value = path;
  diffMessage.value = "";
});

on("git:openCommitForm", () => {
  commitForm.value?.open();
});

on("git:commitDone", () => {
  commitForm.value?.close();
  gitHistory.value?.reload();
  gitFiles.value?.loadWorkingTreeDiff();
});

on("git:stashSave", async () => {
  emit("git:execStashSave");
});

defineExpose({ open, close, showCommitDiff });
</script>
