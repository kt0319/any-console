<template>
  <div
    v-if="modal.visible.value"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @mousedown.self="closeModal"
  >
    <div ref="modalEl" class="modal">
      <div class="modal-header">
        <button
          type="button"
          class="modal-title-wrap"
          :class="{ 'is-clickable': canNavigateBack, 'no-back': !canNavigateBack }"
          :tabindex="canNavigateBack ? 0 : -1"
          :aria-disabled="!canNavigateBack ? 'true' : 'false'"
          @click="canNavigateBack && onBack()"
        >
          <h3 class="modal-title">
            <span v-if="canNavigateBack" class="mdi mdi-arrow-left modal-title-back-icon" aria-hidden="true"></span>
            {{ modalTitle }}<template v-if="modalBranch"><span class="modal-title-sep"> / </span><span class="modal-title-branch" :data-tooltip="modalBranch">{{ modalBranch }}</span></template>
          </h3>
        </button>
        <button type="button" class="modal-close-btn" aria-label="Close" data-tooltip="Close" @click="closeModal">&times;</button>
      </div>
      <div class="modal-body">
        <ModalMenu v-if="currentView === 'ModalMenu'" />
        <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" />
        <WorkspaceAddView v-if="currentView === 'WorkspaceAdd'" />
        <WorkspaceEditPane v-if="currentView === 'WorkspaceEdit'" />
        <JobConfig v-if="currentView === 'JobConfig'" />
        <TabConfig v-if="currentView === 'TabConfig'" />
        <DispatchQueueConfig v-if="currentView === 'DispatchQueueConfig'" />
        <DispatchRunView v-if="currentView === 'DispatchRunView'" />
        <TerminalConfig v-if="currentView === 'TerminalConfig'" />
        <EditorConfig v-if="currentView === 'EditorConfig'" />
        <AuthConfig v-if="currentView === 'AuthConfig'" />
        <PairDeviceConfig v-if="currentView === 'PairDeviceConfig'" />
        <ServerInfo v-if="currentView === 'ServerInfo'" />
        <DisplayConfig v-if="currentView === 'DisplayConfig'" />
        <SnippetConfig v-if="currentView === 'SnippetConfig'" />
        <PreviewPorts v-if="currentView === 'PreviewPorts'" />
        <NotificationConfig v-if="currentView === 'NotificationConfig'" />
        <CircleKeyPadConfig v-if="currentView === 'CircleKeyPadConfig'" />
        <ConfigFile v-if="currentView === 'ConfigFile'" />
        <IconPicker v-if="currentView === 'IconPicker'" />
        <WorkspaceDetail v-if="currentView === 'WorkspaceDetail'" :ref="setPaneRef" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, provide, nextTick, onMounted } from "vue";
import { useModal } from "../composables/useModal.js";
import ModalMenu from "./ModalMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAddView from "./WorkspaceAddView.vue";
import WorkspaceEditPane from "./WorkspaceEditPane.vue";
import JobConfig from "./JobConfig.vue";
import TabConfig from "./TabConfig.vue";
import DispatchQueueConfig from "./DispatchQueueConfig.vue";
import DispatchRunView from "./DispatchRunView.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import AuthConfig from "./AuthConfig.vue";
import PairDeviceConfig from "./PairDeviceConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import DisplayConfig from "./DisplayConfig.vue";
import SnippetConfig from "./SnippetConfig.vue";
import PreviewPorts from "./PreviewPorts.vue";
import NotificationConfig from "./NotificationConfig.vue";
import CircleKeyPadConfig from "./CircleKeyPadConfig.vue";
import ConfigFile from "./ConfigFile.vue";
import IconPicker from "./IconPicker.vue";
import WorkspaceDetail from "./WorkspaceDetail.vue";
import { on } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";

const modal = useModal();
const workspaceStore = useWorkspaceStore();
const modalEl = ref(null);
const currentPaneRef = ref(null);

const viewStack = ref([]);
const currentView = computed(() => viewStack.value.at(-1)?.view ?? null);
const currentState = computed(() => viewStack.value.at(-1)?.state ?? {});
const canNavigateBack = computed(() =>
  currentView.value != null && currentView.value !== "ModalMenu"
);

const modalTitle = ref("");
const modalBranch = ref("");
provide("modalTitle", modalTitle);
provide("modalBranch", modalBranch);
provide("viewState", currentState);
provide("pushView", pushView);
provide("popView", popView);
provide("updateViewState", updateViewState);

function setPaneRef(el) {
  currentPaneRef.value = el;
}

function pushView(view, state = {}) {
  modalBranch.value = "";
  viewStack.value = [...viewStack.value, { view, state }];
}

function updateViewState(state) {
  if (!viewStack.value.length) return;
  const stack = viewStack.value.slice();
  stack[stack.length - 1] = { ...stack[stack.length - 1], state };
  viewStack.value = stack;
}

function popView(result) {
  modalBranch.value = "";
  const popped = viewStack.value.at(-1);
  const newStack = viewStack.value.slice(0, -1);
  if (newStack.length === 0) {
    viewStack.value = newStack;
    closeModal();
    return;
  }
  if (result != null && popped?.state?.onReturn) {
    popped.state.onReturn(result, newStack.at(-1));
  }
  viewStack.value = newStack;
}

function openView(views) {
  viewStack.value = Array.isArray(views)
    ? views : [{ view: views, state: {} }];
  openModal();
}

function openModal() {
  modal.open(() => modalEl.value, closeModal);
}

function closeModal() {
  modal.close();
  viewStack.value = [];
  modalTitle.value = "";
  modalBranch.value = "";
  currentPaneRef.value = null;
}

function onBack() {
  if (currentPaneRef.value?.handleBack?.()) return;
  popView();
}

onMounted(() => {
  on("settings:open", (detail) => {
    if (detail?.view) {
      // 保存済み circle keypad 設定には旧 view 名が残っている可能性があるため読み替える
      const view = detail.view === "PreviewConfig" ? "PreviewPorts" : detail.view;
      openView([
        { view: "ModalMenu", state: {} },
        { view, state: detail.state || {} },
      ]);
    } else {
      openView("ModalMenu");
    }
  });

  on("workspace:openModal", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
  ]));

  on("workspace:openAdd", (detail) => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceAdd", state: { ...detail } },
  ]));

  on("git:openFileModal", (detail) => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceDetail", state: { detail } },
  ]));

  on("preview:showPorts", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "PreviewPorts", state: {} },
  ]));

  on("git:openGitHub", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceDetail", state: { detail: { pane: "issues" } } },
  ]));

  on("git:openHistory", ({ wsName } = {}) => {
    if (wsName) workspaceStore.selectedWorkspace = wsName;
    openView([
      { view: "ModalMenu", state: {} },
      { view: "WorkspaceOpen", state: {} },
      { view: "WorkspaceDetail", state: { detail: { pane: "history" } } },
    ]);
  });

  on("modal:close", () => closeModal());
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
}

.modal {
  background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 8px 0;
  width: 100%;
  max-width: min(600px, 92vw);
  height: calc(var(--app-dvh) * 0.8);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}

.modal-title-wrap {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  justify-content: flex-start;
}

.modal-title-wrap .modal-title {
  font-size: 15px;
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
  text-align: left;
}

.modal-title-wrap.is-clickable {
  cursor: pointer;
}

.modal-title-back-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
  color: inherit;
}

.modal-title-sep {
  color: var(--text-muted);
}

.modal-title-branch {
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 400;
}

.modal-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

:deep(.modal-scroll-body) {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 0 8px;
}

.modal-close-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  flex-shrink: 0;
  margin-left: auto;
  padding: 0;
  font-size: 22px;
  line-height: 1;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (min-width: 900px) {
  .modal-overlay {
    padding: 28px;
  }

  .modal {
    max-width: min(900px, 90vw);
    height: calc(var(--app-dvh) * 0.84);
  }
}

@media (max-width: 768px) {
  .modal-overlay {
    padding: 0;
    align-items: flex-start;
  }

  .modal {
    max-width: 100%;
    height: 100%;
    border: none;
    border-radius: 0;
    flex-direction: column-reverse;
  }

  .modal-header {
    border-bottom: none;
    border-top: 1px solid var(--border);
    margin-bottom: 0;
    margin-top: 8px;
    padding-bottom: calc(env(safe-area-inset-bottom) + 22px);
  }
}
</style>
