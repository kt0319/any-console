<template>
  <div class="workspace-detail">
    <div class="workspace-detail-top">
      <div v-show="activePane !== 'branch' && activePane !== 'stash'" class="file-modal-pane">
        <GitHistory
          ref="gitHistory"
          @pane:select="switchPane"
          @commit:expanded="onCommitExpanded"
          @commit:collapsed="onCommitCollapsed"
        />
      </div>
      <div v-if="activePane === 'branch'" class="file-modal-pane">
        <GitChangeBranch ref="gitBranch" />
      </div>
      <div v-if="activePane === 'stash'" class="file-modal-pane">
        <GitStash ref="gitStash" />
      </div>
    </div>
    <div class="workspace-detail-bottom">
      <div class="file-modal-pane">
        <FileBrowser ref="fileBrowser" :diffFile="selectedDiffFile" :diffMessage="diffMessage" />
      </div>
      <GitCommitForm ref="commitForm" />
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitChangeBranch from "./GitChangeBranch.vue";
import GitStash from "./GitStash.vue";
import GitCommitForm from "./GitCommitForm.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
const workspaceStore = useWorkspaceStore();
const { apiCommand, wsEndpoint } = useApi();
const { modalTitle, viewState, pushView, popView } = useModalView();

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const commitForm = ref(null);

const activePane = ref("browser");
const selectedDiffFile = ref("");
const diffMessage = ref("");
let loadedWorkspace = null;

function updateViewTitle() {
  modalTitle.value = workspaceStore.selectedWorkspace || "Git";
}

function handleBack() {
  if (gitHistory.value?.hasExpanded?.()) {
    gitHistory.value?.closeExpanded?.();
    selectedDiffFile.value = "";
    diffMessage.value = "";
    updateViewTitle();
    return true;
  }
  if (activePane.value === "branch" || activePane.value === "stash") {
    switchPane("browser");
    return true;
  }
  if (selectedDiffFile.value) {
    selectedDiffFile.value = "";
    diffMessage.value = "";
    return true;
  }
  return false;
}

async function open(options) {
  options = options || {};
  activePane.value = options.pane || "browser";
  gitHistory.value?.setActivePane(activePane.value);
  selectedDiffFile.value = "";
  diffMessage.value = "";
  updateViewTitle();

  const workspace = workspaceStore.selectedWorkspace;
  if (workspace !== loadedWorkspace) {
    loadedWorkspace = workspace;
    await gitHistory.value?.load();
  } else {
    gitHistory.value?.reload();
  }

  fileBrowser.value?.load();
}

function switchPane(key) {
  if (key === "graph") {
    pushView("GitLogGraph");
    return;
  }
  activePane.value = key;
  gitHistory.value?.setActivePane(key);
  selectedDiffFile.value = "";
  updateViewTitle();
  if (key === "browser") {
    fileBrowser.value?.load();
  } else if (key === "branch") {
    nextTick(() => {
      gitBranch.value?.load();
      gitBranch.value?.backgroundFetch();
    });
  } else if (key === "stash") {
    nextTick(() => gitStash.value?.load());
  } else if (key === "github") {
    pushView("GitHubPane");
  }
}

function onCommitExpanded({ message }) {
  modalTitle.value = message || workspaceStore.selectedWorkspace || "Git";
}

function onCommitCollapsed() {
  updateViewTitle();
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

on("git:checkoutBranch", async ({ branch, remote }) => {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote });
  if (!ok) return;
  switchPane("browser");
  gitHistory.value?.reload();
  fileBrowser.value?.load();
});

on("git:stashSave", async () => {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true });
  if (!ok) return;
  gitHistory.value?.reload();
});

defineExpose({ handleBack });

onMounted(() => {
  const detail = viewState.value?.detail;
  open(detail);
});
</script>

<style scoped>
.workspace-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.workspace-detail-top {
  flex: 1 1 33.333%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace-detail-bottom {
  flex: 2 1 66.667%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace-detail-bottom.workspace-detail-full {
  flex: unset;
  height: 100%;
}

.file-modal-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
