<template>
  <BaseDialog :visible="!!path" :z-index="DIALOG_Z_INDEX_TOP" @dismiss="close">
    <div class="path-preview-dialog dialog-box" :class="{ 'path-preview-dialog-image': isImage }" role="dialog" aria-modal="true" aria-label="Preview file">
      <DialogCloseButton @close="close" />
      <div class="dialog-title dialog-title-closable">Preview file<span v-if="isImage" class="path-preview-zoom">{{ zoomLabel }}</span></div>
      <DialogCopyField :value="path" label="path" />
      <div class="path-preview-body" :class="{ 'path-preview-body-image': isImage }">
        <FileTextViewer v-if="fileContent" :fileContent="fileContent" :fileName="path" @zoom="imageZoom = $event" />
        <div v-else class="path-preview-loading">Loading...</div>
      </div>
      <div class="dialog-buttons">
        <button class="dialog-btn dialog-btn-ok path-preview-download" :disabled="!fileContent" @click="download">
          <span class="mdi mdi-download"></span>Download
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { DIALOG_Z_INDEX_TOP } from "../utils/constants.ts";
import { computed, ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import DialogCopyField from "./DialogCopyField.vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useApi } from "../composables/useApi.ts";
import { useBusListener } from "../composables/useBusListener.ts";
import { useWorkspaceFile } from "../composables/useWorkspaceFile.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { emit } from "../app-bridge.ts";
import { terminalSessionOpenPath } from "../utils/endpoints.ts";

const { apiGet } = useApi();
const { downloadTerminalOpenedPath } = useWorkspaceFile();
const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const path = ref("");
const sessionId = ref("");
const fileContent = ref<Record<string, any> | null>(null);
const imageZoom = ref(1);
const zoomLabel = computed(() => `${Math.round(imageZoom.value * 100)}%`);
const isImage = computed(() => !!(fileContent.value?.image && fileContent.value?.data_url));

function download() {
  return downloadTerminalOpenedPath(sessionId.value, path.value);
}

function close() {
  path.value = "";
  fileContent.value = null;
}

useBusListener("terminal:path", async ({ path: requested, sessionId: requestedSessionId }) => {
  path.value = requested;
  sessionId.value = requestedSessionId;
  fileContent.value = null;
  const { ok, data } = await apiGet(terminalSessionOpenPath(requestedSessionId, requested), { errorMessage: `Cannot open "${requested}"` });
  if (path.value !== requested) return;
  if (!ok) {
    close();
    return;
  }
  const workspace = terminalStore.openTabs.find((t) => t.sessionId === requestedSessionId)?.workspace;
  if (workspace && data?.workspace_path) {
    close();
    workspaceStore.selectedWorkspace = workspace;
    emit("git:openFileModal", { pane: "files", filePath: data.workspace_path });
    return;
  }
  fileContent.value = data;
});
</script>

<style scoped>
.path-preview-download {
  margin-right: auto;
}

.path-preview-dialog {
  --path-preview-chrome-height: 190px;
  width: calc(100vw - 16px);
  max-height: calc(var(--app-dvh) - 16px);
  /* .dialog-overlay の padding（20px）を打ち消し、画面端との余白を 8px にする */
  margin: -12px;
  box-sizing: border-box;
}

.path-preview-zoom {
  margin-left: 10px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 400;
}

.path-preview-body {
  flex: 0 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  padding: 6px;
}

/* 画像は枠・背景・余白をなくし、画面いっぱいに表示する */
.path-preview-dialog-image {
  padding: 6px;
  gap: 6px;
}

.path-preview-dialog-image .dialog-title {
  padding: 13px 38px 0 8px;
  margin-bottom: 8px;
}

.path-preview-body-image {
  display: flex;
  overflow: hidden;
  border: none;
  background: transparent;
  padding: 0;
}

/* ダイアログの高さが内容で決まるため、画像の上限はパス行とボタン行を除いた画面高さで与える */
.path-preview-body-image :deep(.file-content-image-wrap) {
  padding: 0;
  max-height: calc(var(--app-dvh) - var(--path-preview-chrome-height));
}

/* 縦中央寄せは align-items:center ではなく auto マージンで行う（center だと拡大して枠より
   高くなった画像の上側が、スクロールで届かない領域にはみ出す） */
.path-preview-body-image :deep(.file-content-image) {
  margin: auto;
  max-height: calc(var(--app-dvh) - var(--path-preview-chrome-height));
  border: none;
  border-radius: 0;
  background: transparent;
}

.path-preview-body-image :deep(.file-content-image.file-content-image-zoomed) {
  max-width: none;
  max-height: none;
}

.path-preview-loading {
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px;
}
</style>
