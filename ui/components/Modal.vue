<template>
  <div
    v-if="modal.visible.value"
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    @click.self="closeModal"
  >
    <div ref="modalEl" class="modal">
      <div class="modal-header">
        <button
          type="button"
          class="modal-title-wrap"
          :class="{ 'is-clickable': canNavigateBack, 'no-back': !canNavigateBack }"
          :tabindex="canNavigateBack ? 0 : -1"
          :aria-disabled="!canNavigateBack ? 'true' : 'false'"
          @click="canNavigateBack ? onBack() : null"
        >
          <h3 class="modal-title">
            <span v-if="canNavigateBack" class="mdi mdi-arrow-left modal-title-back-icon" aria-hidden="true"></span>
            {{ modalTitle }}
          </h3>
        </button>
        <button type="button" class="modal-close-btn" @click="closeModal">&times;</button>
      </div>
      <div class="modal-body">
        <ModalMenu v-if="currentView === 'ModalMenu'" />
        <WorkspaceOpen v-if="currentView === 'WorkspaceOpen'" />
        <WorkspaceAdd v-if="currentView === 'WorkspaceAdd'" />
        <WorkspaceConfig v-if="currentView === 'WorkspaceConfig'" :ref="setPaneRef" />
        <JobConfig v-if="currentView === 'JobConfig'" />
        <GlobalJobConfig v-if="currentView === 'GlobalJobConfig'" :ref="setPaneRef" />
        <TabConfig v-if="currentView === 'TabConfig'" />
        <TerminalConfig v-if="currentView === 'TerminalConfig'" />
        <EditorConfig v-if="currentView === 'EditorConfig'" />
        <ServerInfo v-if="currentView === 'ServerInfo'" />
        <GitHubPane v-if="currentView === 'GitHubPane'" />
        <GitLogGraph v-if="currentView === 'GitLogGraph'" />
        <ConfigFile v-if="currentView === 'ConfigFile'" />
        <IconPicker v-if="currentView === 'IconPicker'" />
        <WorkspaceDetail v-if="currentView === 'WorkspaceDetail'" :ref="setPaneRef" />
      </div>
      <div
        class="modal-flick-handle"
        @touchstart.passive="onFlickStart"
        @touchmove="onFlickMove"
        @touchend="onFlickEnd"
        @touchcancel="onFlickCancel"
      >
        <span class="modal-flick-bar"></span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, provide, nextTick, onMounted } from "vue";
import { useModal } from "../composables/useModal.js";
import { useSwipeDismiss } from "../composables/useSwipeDismiss.js";
import ModalMenu from "./ModalMenu.vue";
import WorkspaceOpen from "./WorkspaceOpen.vue";
import WorkspaceAdd from "./WorkspaceAdd.vue";
import WorkspaceConfig from "./WorkspaceConfig.vue";
import JobConfig from "./JobConfig.vue";
import GlobalJobConfig from "./GlobalJobConfig.vue";
import TabConfig from "./TabConfig.vue";
import TerminalConfig from "./TerminalConfig.vue";
import EditorConfig from "./EditorConfig.vue";
import ServerInfo from "./ServerInfo.vue";
import ConfigFile from "./ConfigFile.vue";
import GitHubPane from "./GitHubPane.vue";
import GitLogGraph from "./GitLogGraph.vue";
import IconPicker from "./IconPicker.vue";
import WorkspaceDetail from "./WorkspaceDetail.vue";
import { on } from "../app-bridge.js";

const modal = useModal();
const modalEl = ref(null);
const currentPaneRef = ref(null);

const viewStack = ref([]);
const currentView = computed(() => viewStack.value.at(-1)?.view ?? null);
const currentState = computed(() => viewStack.value.at(-1)?.state ?? {});
const canNavigateBack = computed(() =>
  currentView.value != null && currentView.value !== "ModalMenu"
);

const modalTitle = ref("");
provide("modalTitle", modalTitle);
provide("viewState", currentState);
provide("pushView", pushView);
provide("popView", popView);

const {
  resetStyle: resetFlickStyle,
  onStart: onFlickStart,
  onMove: onFlickMove,
  onEnd: onFlickEnd,
  onCancel: onFlickCancel,
} = useSwipeDismiss(modalEl, () => closeModal(), { threshold: 80 });

function setPaneRef(el) {
  currentPaneRef.value = el;
}

function pushView(view, state = {}) {
  viewStack.value = [...viewStack.value, { view, state }];
}

function popView(result) {
  const popped = viewStack.value.at(-1);
  viewStack.value = viewStack.value.slice(0, -1);
  if (viewStack.value.length === 0) { closeModal(); return; }
  if (result != null && popped?.state?.onReturn) {
    popped.state.onReturn(result, viewStack.value.at(-1));
    viewStack.value = [...viewStack.value];
  }
}

function openView(views) {
  viewStack.value = Array.isArray(views)
    ? views : [{ view: views, state: {} }];
  nextTick(() => openModal());
}

function openModal() {
  modal.open(modalEl.value, closeModal);
}

function closeModal() {
  resetFlickStyle();
  modal.close();
  viewStack.value = [];
  modalTitle.value = "";
  currentPaneRef.value = null;
}

function onBack() {
  if (currentPaneRef.value?.handleBack?.()) return;
  popView();
}

onMounted(() => {
  on("settings:open", (detail) => {
    if (detail?.view) {
      openView([
        { view: "ModalMenu", state: {} },
        { view: detail.view, state: {} },
      ]);
    } else {
      openView("ModalMenu");
    }
  });
  on("settings:close", () => closeModal());

  on("workspace:openModal", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
  ]));

  on("git:openFileModal", (detail) => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceDetail", state: { detail } },
  ]));
  on("git:closeFileModal", () => closeModal());

  on("git:openGitHub", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceDetail", state: {} },
    { view: "GitHubPane", state: {} },
  ]));

  on("git:openLogGraph", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceDetail", state: {} },
    { view: "GitLogGraph", state: {} },
  ]));

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
}

.modal-title-wrap {
  display: inline-flex;
  align-items: center;
  flex: 1;
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

.modal-flick-handle {
  display: none;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  touch-action: none;
}

.modal-flick-bar {
  width: 48px;
  height: 5px;
  border-radius: 3px;
  background: var(--text-muted);
  opacity: 0.5;
}

.modal-close-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  flex-shrink: 0;
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
  outline: none;
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
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .modal-flick-handle {
    display: flex;
    padding: 10px 0 calc(env(safe-area-inset-bottom) + 40px);
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  }
}
</style>
