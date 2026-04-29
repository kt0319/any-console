<template>
  <div class="workspace-detail">
    <div v-show="topRatio > 0" class="workspace-detail-top" :style="{ flex: topRatio + ' 1 0%' }">
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
    <div
      class="workspace-detail-handle"
      @mousedown="onHandlePointerDown"
      @touchstart.prevent="onHandlePointerDown"
    >
      <span class="handle-line"></span>
      <span class="handle-grip mdi mdi-drag-horizontal"></span>
      <span class="handle-line"></span>
    </div>
    <div v-show="topRatio < 1" class="workspace-detail-bottom" :style="{ flex: (1 - topRatio) + ' 1 0%' }">
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
const topRatio = ref(0.33);
const selectedDiffFile = ref("");
const diffMessage = ref("");

let lastRatioBeforeCollapse = 0.33;
let lastTapTime = 0;
const DOUBLE_TAP_MS = 300;

function onHandleDoubleTap() {
  if (topRatio.value >= 1.0) {
    topRatio.value = 0.0;
  } else if (topRatio.value <= 0.0) {
    topRatio.value = 1.0;
  } else {
    lastRatioBeforeCollapse = topRatio.value;
    topRatio.value = topRatio.value >= 0.5 ? 1.0 : 0.0;
  }
}

function onHandlePointerDown(e) {
  const now = Date.now();
  if (now - lastTapTime < DOUBLE_TAP_MS) {
    lastTapTime = 0;
    onHandleDoubleTap();
    return;
  }
  lastTapTime = now;
  onHandleDragStart(e);
}

function onHandleDragStart(e) {
  const startY = e.touches ? e.touches[0].clientY : e.clientY;
  const container = e.target.closest(".workspace-detail");
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const startRatio = topRatio.value;

  let didMove = false;

  function onMove(ev) {
    if (ev.cancelable) ev.preventDefault();
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const dy = clientY - startY;
    if (Math.abs(dy) > 3) didMove = true;
    const newRatio = startRatio + dy / containerRect.height;
    topRatio.value = Math.max(0.0, Math.min(1.0, newRatio));
  }

  function onEnd() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
    if (didMove) {
      lastTapTime = 0;
      if (topRatio.value < 0.05) topRatio.value = 0.0;
      else if (topRatio.value > 0.95) topRatio.value = 1.0;
      else if (topRatio.value > 0.28 && topRatio.value < 0.38) topRatio.value = 0.33;
    }
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onEnd);
  document.addEventListener("touchmove", onMove, { passive: false });
  document.addEventListener("touchend", onEnd);
  document.addEventListener("touchcancel", onEnd);
}
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
  topRatio.value = 0.33;
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
  const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote }, { errorMessage: "Checkout failed" });
  if (!ok) return;
  switchPane("browser");
  gitHistory.value?.reload();
  fileBrowser.value?.load();
});

on("git:stashSave", async () => {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true }, { errorMessage: "Stash save failed" });
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
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace-detail-bottom {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace-detail-handle {
  display: flex;
  align-items: center;
  padding: 6px 0;
  flex-shrink: 0;
  cursor: row-resize;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.handle-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}

.handle-grip {
  flex-shrink: 0;
  padding: 0 24px;
  font-size: 20px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  line-height: 1;
}

.file-modal-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
