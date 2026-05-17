<template>
  <div class="modal-scroll-body">
    <WorkspaceAddInline @added="onAdded" />
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import WorkspaceAddInline from "./WorkspaceAddInline.vue";
import { useModalView } from "../composables/useModalView.js";
import { useWorkspaceStore } from "../stores/workspace.js";

const { modalTitle, popView } = useModalView();
const workspaceStore = useWorkspaceStore();

onMounted(() => { modalTitle.value = "Add Workspace"; });

async function onAdded() {
  await workspaceStore.fetchWorkspaces();
  popView(true);
}
</script>
