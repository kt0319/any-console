<template>
  <div class="workspace-detail">
    <div class="workspace-detail-top">
      <GitHistory ref="gitHistory" />
    </div>
    <div class="workspace-detail-bottom">
      <TabPills :panes="PANES" :active-key="activePane" @select="switchPane" />
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
  </div>
</template>

<script setup>
import { ref } from "vue";
import TabPills from "./TabPills.vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitFiles from "./GitFiles.vue";
import GitBranch from "./GitBranch.vue";
import GitStash from "./GitStash.vue";
import GitGitHub from "./GitGitHub.vue";
import DiffViewer from "./DiffViewer.vue";
import CommitForm from "./CommitForm.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
const workspaceStore = useWorkspaceStore();

const emit = defineEmits(["update:title", "update:back", "close"]);

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitFiles = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const gitGitHub = ref(null);
const commitForm = ref(null);

const activePane = ref("browser");
const selectedDiffFile = ref("");
const diffMessage = ref("");
const diffPaneTitle = ref("未コミットの変更");
const commitViewMessage = ref("");
let loadedWorkspace = null;

const PANES = [
  { key: "browser", label: "ファイル" },
  { key: "files", label: "変更" },
  { key: "branch", label: "ブランチ" },
  { key: "stash", label: "Stash" },
  { key: "github", label: "GitHub" },
];


function currentTitle() {
  if (commitViewMessage.value) return commitViewMessage.value;
  return workspaceStore.selectedWorkspace || "Git";
}

function emitTitleAndBack() {
  emit("update:title", currentTitle());
  emit("update:back", true);
}

function goBack() {
  if (commitViewMessage.value) {
    commitViewMessage.value = "";
    activePane.value = "browser";
    diffPaneTitle.value = "未コミットの変更";
    selectedDiffFile.value = "";
    diffMessage.value = "";
    emitTitleAndBack();
  } else {
    close();
    bridgeEmit("workspace:openModal");
  }
}

async function open(options) {
  options = options || {};
  activePane.value = options.pane || "browser";
  selectedDiffFile.value = "";
  diffMessage.value = "";
  diffPaneTitle.value = "未コミットの変更";
  commitViewMessage.value = "";
  emitTitleAndBack();

  const workspace = workspaceStore.selectedWorkspace;
  if (workspace !== loadedWorkspace) {
    loadedWorkspace = workspace;
    await gitHistory.value?.load();
  } else {
    gitHistory.value?.reload();
  }

  fileBrowser.value?.load();

  if (activePane.value === "files") {
    await gitFiles.value?.loadWorkingTreeDiff();
  }
}

function close() {
  emit("close");
  loadedWorkspace = null;
  bridgeEmit("git:modalClosed");
}

function switchPane(key) {
  activePane.value = key;
  commitViewMessage.value = "";
  emitTitleAndBack();
  if (key === "browser") {
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
  emitTitleAndBack();
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
  bridgeEmit("git:execStashSave");
});

defineExpose({ open, close, goBack, showCommitDiff });
</script>
