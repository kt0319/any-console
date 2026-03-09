<template>
  <div class="workspace-detail">
    <div class="workspace-detail-top">
      <GitHistory ref="gitHistory" @pane:select="switchPane" />
      <div v-show="activePane === 'branch'" class="file-modal-pane">
        <GitBranch ref="gitBranch" />
      </div>
      <div v-show="activePane === 'stash'" class="file-modal-pane">
        <GitStash ref="gitStash" />
      </div>
    </div>
    <div class="workspace-detail-bottom">
      <div v-show="selectedDiffFile" class="file-modal-pane">
        <FileDiffViewer :file="selectedDiffFile" :message="diffMessage" />
      </div>
      <div v-show="!selectedDiffFile" class="file-modal-pane">
        <FileBrowser ref="fileBrowser" />
      </div>
      <GitCommitForm ref="commitForm" />
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitBranch from "./GitBranch.vue";
import GitStash from "./GitStash.vue";
import FileDiffViewer from "./FileDiffViewer.vue";
import GitCommitForm from "./GitCommitForm.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const emit = defineEmits(["update:title", "update:back", "close"]);

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const commitForm = ref(null);

const activePane = ref("browser");
const selectedDiffFile = ref("");
const diffMessage = ref("");
let loadedWorkspace = null;



function currentTitle() {
  return workspaceStore.selectedWorkspace || "Git";
}

function emitTitleAndBack() {
  emit("update:title", currentTitle());
  emit("update:back", true);
}

function goBack() {
  if (selectedDiffFile.value) {
    selectedDiffFile.value = "";
    diffMessage.value = "";
  } else {
    close();
    bridgeEmit("workspace:openModal");
  }
}

async function open(options) {
  options = options || {};
  activePane.value = options.pane || "browser";
  gitHistory.value?.setActivePane(activePane.value);
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

}

function close() {
  emit("close");
  loadedWorkspace = null;
  bridgeEmit("git:modalClosed");
}

function switchPane(key) {
  activePane.value = key;
  gitHistory.value?.setActivePane(key);
  selectedDiffFile.value = "";
  emitTitleAndBack();
  if (key === "browser") {
    fileBrowser.value?.load();
  } else if (key === "branch") {
    gitBranch.value?.load();
    gitBranch.value?.backgroundFetch();
  } else if (key === "stash") {
    gitStash.value?.load();
  } else if (key === "github") {
    bridgeEmit("git:openGitHub");
  }
}

on("git:selectDirty", () => {
  selectedDiffFile.value = "";
  diffMessage.value = "";
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
});

on("git:stashSave", async () => {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/stash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ include_untracked: true }),
  });
  if (!res || !res.ok) return;
  gitHistory.value?.reload();
});

defineExpose({ open, close, goBack });
</script>
