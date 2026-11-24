<template>
  <BaseDialog :visible="!!workspaceName" :z-index="DIALOG_Z_INDEX_RAISED" @dismiss="close">
    <div class="ws-job-dialog dialog-box" style="--dialog-width: 360px" role="dialog" aria-modal="true" :aria-label="`Select job for ${workspaceName}`">
      <DialogCloseButton @close="close" />
      <div class="dialog-title dialog-title-closable">{{ workspaceName }}</div>
      <div class="ws-job-dialog-body">
        <WorkspaceJobsPane :workspace="workspaceName" @select="close" />
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import WorkspaceJobsPane from "./WorkspaceJobsPane.vue";
import { DIALOG_Z_INDEX_RAISED } from "../utils/constants.ts";

// ワークスペース（worktree含む）のジョブ選択ダイアログ。ジョブを選んだ時点で閉じる
// （確認ダイアログなど後続の操作はWorkspaceJobsPane側が引き続き処理する）。
const workspaceName = ref("");

function open(name: string) {
  workspaceName.value = name;
}

function close() {
  workspaceName.value = "";
}

defineExpose({ open });
</script>

<style scoped>
.ws-job-dialog-body {
  max-height: 60vh;
  overflow-y: auto;
  margin-top: 8px;
}
</style>
