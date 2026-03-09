<template>
  <div class="workspace-detail">
    <div class="workspace-detail-top">
      <div v-show="activePane !== 'branch' && activePane !== 'stash' && activePane !== 'graph'" class="file-modal-pane">
        <GitHistory ref="gitHistory" @pane:select="switchPane" />
      </div>
      <div v-if="activePane === 'branch'" class="file-modal-pane">
        <GitChangeBranch ref="gitBranch" />
      </div>
      <div v-if="activePane === 'stash'" class="file-modal-pane">
        <GitStash ref="gitStash" />
      </div>
      <div v-if="activePane === 'graph'" class="file-modal-pane">
        <GitCommitGraph ref="gitGraph" />
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
import { ref, inject, nextTick } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitChangeBranch from "./GitChangeBranch.vue";
import GitStash from "./GitStash.vue";
import GitCommitGraph from "./GitCommitGraph.vue";
import GitCommitForm from "./GitCommitForm.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const modalTitle = inject("modalTitle");
const emit = defineEmits(["close"]);

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const gitGraph = ref(null);
const commitForm = ref(null);

const activePane = ref("browser");
const selectedDiffFile = ref("");
const diffMessage = ref("");
let loadedWorkspace = null;

function updateViewTitle() {
  modalTitle.value = workspaceStore.selectedWorkspace || "Git";
}

function goBack() {
  if (activePane.value === "branch" || activePane.value === "stash" || activePane.value === "graph") {
    switchPane("browser");
  } else if (selectedDiffFile.value) {
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

function close() {
  emit("close");
  loadedWorkspace = null;
  bridgeEmit("git:modalClosed");
}

function switchPane(key) {
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
  } else if (key === "graph") {
    nextTick(() => gitGraph.value?.load());
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
    body: { include_untracked: true },
  });
  if (!res || !res.ok) return;
  gitHistory.value?.reload();
});

defineExpose({ open, close, goBack });
</script>
