<template>
  <BaseDialog :visible="!!path" :z-index="DIALOG_Z_INDEX_TOP" @dismiss="close">
    <div class="path-preview-dialog dialog-box" :class="{ 'path-preview-dialog-image': isImage }" role="dialog" aria-modal="true" aria-label="Open file">
      <div class="dialog-title">Open file</div>
      <DialogCopyField :value="path" label="path" />
      <div class="path-preview-body" :class="{ 'path-preview-body-image': isImage }">
        <FileTextViewer v-if="fileContent" :fileContent="fileContent" :fileName="path" />
        <div v-else class="path-preview-loading">Loading...</div>
      </div>
      <div class="dialog-buttons">
        <button class="dialog-btn dialog-btn-cancel" @click="close">Close</button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { DIALOG_Z_INDEX_TOP } from "../utils/constants.ts";
import { computed, ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import DialogCopyField from "./DialogCopyField.vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useApi } from "../composables/useApi.ts";
import { useBusListener } from "../composables/useBusListener.ts";
import { terminalSessionOpenPath } from "../utils/endpoints.ts";

const { apiGet } = useApi();
const path = ref("");
const fileContent = ref<Record<string, any> | null>(null);
const isImage = computed(() => !!(fileContent.value?.image && fileContent.value?.data_url));

function close() {
  path.value = "";
  fileContent.value = null;
}

useBusListener("terminal:path", async ({ path: requested, sessionId }) => {
  path.value = requested;
  fileContent.value = null;
  const { ok, data } = await apiGet(terminalSessionOpenPath(sessionId, requested), { errorMessage: `Cannot open "${requested}"` });
  if (path.value !== requested) return;
  if (!ok) {
    close();
    return;
  }
  fileContent.value = data;
});
</script>

<style scoped>
.path-preview-dialog {
  --path-preview-chrome-height: 190px;
  width: calc(100vw - 16px);
  max-height: calc(var(--app-dvh) - 16px);
  /* .dialog-overlay の padding（20px）を打ち消し、画面端との余白を 8px にする */
  margin: -12px;
  box-sizing: border-box;
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
  align-items: center;
  max-height: calc(var(--app-dvh) - var(--path-preview-chrome-height));
}

.path-preview-body-image :deep(.file-content-image) {
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
