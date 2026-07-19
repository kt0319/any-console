<template>
  <div class="modal-scroll-body">
    <WorkspaceAddInline :initial-path="initialPath" @added="onAdded" />
  </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import WorkspaceAddInline from "./WorkspaceAddInline.vue";
import { useModalView } from "../composables/useModalView.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useSessionSync } from "../composables/useSessionSync.js";
import { useApi } from "../composables/useApi.js";
import { terminalSessionWorkspacePath } from "../utils/endpoints.js";

const { modalTitle, popView, viewState } = useModalView();
const workspaceStore = useWorkspaceStore();
const { syncSessionsFromServer } = useSessionSync();
const { apiPut } = useApi();

const initialPath = computed(() => viewState.value?.initialPath || "");

onMounted(() => { modalTitle.value = "Add Workspace"; });

async function onAdded(name) {
  await workspaceStore.fetchWorkspaces();
  // 素のターミナルからの登録時は、追加したワークスペースを発火元タブに紐付ける。
  const sessionId = viewState.value?.attachSessionId;
  if (name && sessionId) {
    await apiPut(terminalSessionWorkspacePath(sessionId), { workspace: name });
    // タブ表示（ラベル・アイコン）は同期 reconcile がサーバ値へ揃える。
    await syncSessionsFromServer();
    workspaceStore.selectedWorkspace = name;
    await workspaceStore.fetchStatuses();
  }
  popView(true);
}
</script>
