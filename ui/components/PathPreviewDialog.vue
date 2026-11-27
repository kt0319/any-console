<template>
  <BaseDialog :visible="!!path" :z-index="DIALOG_Z_INDEX_TOP" @dismiss="close">
    <div class="path-preview-dialog dialog-box" :class="{ 'path-preview-dialog-image': isImage }" role="dialog" aria-modal="true" :aria-label="dialogTitle">
      <DialogCloseButton @close="close" />
      <div class="dialog-title dialog-title-closable">{{ dialogTitle }}</div>
      <DialogCopyField :value="path" label="path" />
      <div class="path-preview-body" :class="{ 'path-preview-body-image': isImage }">
        <ul v-if="directory" class="path-preview-entries">
          <li>
            <button type="button" class="path-preview-entry hover-bg" @click="openPath(parentPath)">
              <span class="mdi mdi-folder-arrow-up-outline" aria-hidden="true"></span>
              <span class="path-preview-entry-name">..</span>
            </button>
          </li>
          <li v-for="entry in directory.entries" :key="entry.name">
            <button type="button" class="path-preview-entry hover-bg" @click="openPath(childPath(entry.name))">
              <span class="mdi" :class="entry.type === 'dir' ? 'mdi-folder-outline' : 'mdi-file-outline'" aria-hidden="true"></span>
              <span class="path-preview-entry-name">{{ entry.name }}</span>
            </button>
          </li>
        </ul>
        <FileTextViewer v-else-if="fileContent" :fileContent="fileContent" :fileName="path" v-model:zoom="imageZoom" />
        <div v-else class="path-preview-loading">Loading...</div>
      </div>
      <div class="dialog-buttons">
        <div v-if="isImage" class="path-preview-zoom">
          <button
            type="button"
            class="icon-btn-square path-preview-zoom-btn"
            aria-label="Zoom out"
            data-tooltip="Zoom out"
            :disabled="imageZoom <= IMAGE_ZOOM_MIN"
            @click="imageZoom = stepZoom(imageZoom, -1)"
          ><span class="mdi mdi-minus"></span></button>
          <button
            type="button"
            class="path-preview-zoom-label"
            aria-label="Reset zoom to 100%"
            data-tooltip="Reset zoom to 100%"
            :disabled="imageZoom === 1"
            @click="imageZoom = 1"
          >{{ zoomLabel }}</button>
          <button
            type="button"
            class="icon-btn-square path-preview-zoom-btn"
            aria-label="Zoom in"
            data-tooltip="Zoom in"
            :disabled="imageZoom >= IMAGE_ZOOM_MAX"
            @click="imageZoom = stepZoom(imageZoom, 1)"
          ><span class="mdi mdi-plus"></span></button>
        </div>
        <button v-if="!directory" class="dialog-btn dialog-btn-ok path-preview-download" :disabled="!fileContent" @click="download">
          <span class="mdi mdi-download"></span>Download
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { DIALOG_Z_INDEX_TOP, IMAGE_ZOOM_MAX, IMAGE_ZOOM_MIN } from "../utils/constants.ts";
import { computed, ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import DialogCloseButton from "./DialogCloseButton.vue";
import DialogCopyField from "./DialogCopyField.vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useApi } from "../composables/useApi.ts";
import { useBusListener } from "../composables/useBusListener.ts";
import { useWorkspaceFile } from "../composables/useWorkspaceFile.ts";
import { stepZoom } from "../utils/pinch-zoom.ts";
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
const directory = ref<{ entries: { name: string, type: string }[] } | null>(null);
const imageZoom = ref(1);
const zoomLabel = computed(() => `${Math.round(imageZoom.value * 100)}%`);
const isDirectory = computed(() => !!directory.value);
const dialogTitle = computed(() => (isDirectory.value ? "Preview directory" : "Preview file"));
const parentPath = computed(() => path.value.replace(/\/[^/]*\/?$/, "") || "/");
const isImage = computed(() => !!(fileContent.value?.image && fileContent.value?.data_url));

function download() {
  return downloadTerminalOpenedPath(sessionId.value, path.value);
}

function childPath(name: string) {
  return `${path.value.replace(/\/$/, "")}/${name}`;
}

function close() {
  path.value = "";
  fileContent.value = null;
  directory.value = null;
  imageZoom.value = 1;
}

async function openPath(requested: string) {
  path.value = requested;
  fileContent.value = null;
  directory.value = null;
  imageZoom.value = 1;
  const { ok, data } = await apiGet(terminalSessionOpenPath(sessionId.value, requested), { errorMessage: `Cannot open "${requested}"` });
  if (path.value !== requested) return;
  if (!ok) {
    close();
    return;
  }
  const workspace = terminalStore.openTabs.find((t) => t.sessionId === sessionId.value)?.workspace;
  if (workspace && data?.workspace_path) {
    close();
    workspaceStore.selectedWorkspace = workspace;
    emit("git:openFileModal", data.directory
      ? { pane: "files", dirPath: data.workspace_path }
      : { pane: "files", filePath: data.workspace_path });
    return;
  }
  if (data?.directory) {
    path.value = data.path;
    directory.value = data;
    return;
  }
  fileContent.value = data;
}

useBusListener("terminal:path", ({ path: requested, sessionId: requestedSessionId }) => {
  sessionId.value = requestedSessionId;
  return openPath(requested);
});
</script>

<style scoped>
.path-preview-download {
  margin-left: auto;
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
  display: flex;
  align-items: center;
  gap: 8px;
}

.path-preview-zoom-btn {
  width: 44px;
  height: 44px;
}

.path-preview-zoom-btn:disabled {
  opacity: 0.4;
}

.path-preview-zoom-label {
  flex-shrink: 0;
  min-width: 56px;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.path-preview-zoom-label:disabled {
  opacity: 0.4;
  cursor: default;
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

.path-preview-entries {
  list-style: none;
  margin: 0;
  padding: 0;
}

.path-preview-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.path-preview-entry-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-preview-loading {
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px;
}
</style>
