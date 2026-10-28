<template>
  <BaseDialog :visible="!!path" :z-index="1000" @dismiss="close">
    <div class="path-preview-dialog" :class="{ 'path-preview-dialog-image': isImage }" role="dialog" aria-modal="true" aria-label="Open file">
      <div class="path-preview-path">{{ path }}</div>
      <div class="path-preview-body" :class="{ 'path-preview-body-image': isImage }">
        <FileTextViewer v-if="fileContent" :fileContent="fileContent" :fileName="path" />
      </div>
      <div class="path-preview-buttons">
        <button class="path-preview-btn hover-bg" @click="copy(path)">
          <span class="mdi" :class="copied ? 'mdi-check' : 'mdi-content-copy'"></span>{{ copied ? "Copied!" : "Copy path" }}
        </button>
        <button class="path-preview-btn path-preview-btn-cancel hover-bg" @click="close">Close</button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useBusListener } from "../composables/useBusListener.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";

const path = ref("");
const fileContent = ref<Record<string, any> | null>(null);
const isImage = computed(() => !!(fileContent.value?.image && fileContent.value?.data_url));
const { copied, copy } = useCopyFeedback();

function close() {
  path.value = "";
  fileContent.value = null;
}

useBusListener("terminal:path", (detail) => {
  path.value = detail.path;
  fileContent.value = detail.fileContent;
  copied.value = false;
});
</script>

<style scoped>
.path-preview-dialog {
  --path-preview-chrome-height: 120px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  width: calc(100vw - 16px);
  max-height: calc(var(--app-dvh) - 16px);
  /* .dialog-overlay の padding（20px）を打ち消し、画面端との余白を 8px にする */
  margin: -12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}

.path-preview-path {
  font-size: 11px;
  color: var(--text-muted);
  white-space: normal;
  word-break: break-all;
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

.path-preview-buttons {
  display: flex;
  gap: 6px;
}

.path-preview-btn {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  min-height: 0;
}

.path-preview-btn-cancel {
  color: var(--text-muted);
}
</style>
