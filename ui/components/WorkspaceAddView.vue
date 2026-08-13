<template>
  <div class="modal-scroll-body">
    <WorkspaceAddInline :initial-path="initialPath" @added="onAdded" />
  </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import WorkspaceAddInline from "./WorkspaceAddInline.vue";
import { useModalView } from "../composables/useModalView.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useApi } from "../composables/useApi.ts";
import { terminalSessionWorkspacePath } from "../utils/endpoints.ts";

const { modalTitle, popView, viewState } = useModalView();
const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();
const { apiPut } = useApi();

const initialPath = computed(() => viewState.value?.initialPath || "");

onMounted(() => { modalTitle.value = "Add Workspace"; });

async function onAdded(name) {
  await workspaceStore.fetchWorkspaces();
  // 素のターミナルからの登録時は、追加したワークスペースを発火元タブに紐付ける。
  const sessionId = viewState.value?.attachSessionId;
  const tabId = viewState.value?.attachTabId;
  if (name && sessionId && tabId != null) {
    await apiPut(terminalSessionWorkspacePath(sessionId), { workspace: name });
    const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
    terminalStore.setTabWorkspace(tabId, name, ws ? { icon: ws.icon, iconColor: ws.icon_color } : null);
    workspaceStore.selectedWorkspace = name;
    await workspaceStore.fetchStatuses();
  }
  popView(true);
}
</script>
