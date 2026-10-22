<template>
  <BaseDialog :visible="!!path" :z-index="1000" @dismiss="close">
    <div class="path-preview-dialog" :class="{ 'path-preview-dialog-open': previewing }" role="dialog" aria-modal="true" aria-label="Open file">
      <div class="path-preview-path">{{ path }}</div>
      <div v-if="previewing" class="path-preview-body">
        <FileTextViewer v-if="fileContent" :fileContent="fileContent" :fileName="path" />
      </div>
      <div class="path-preview-buttons" :class="{ 'path-preview-buttons-row': previewing }">
        <button v-if="!previewing" class="path-preview-btn hover-bg" @click="previewing = true">
          <span class="mdi mdi-open-in-new"></span>Open
        </button>
        <button v-if="!previewing" class="path-preview-btn hover-bg" @click="copy(path)">
          <span class="mdi" :class="copied ? 'mdi-check' : 'mdi-content-copy'"></span>{{ copied ? "Copied!" : "Copy path" }}
        </button>
        <button class="path-preview-btn path-preview-btn-cancel hover-bg" @click="close">{{ previewing ? "Close" : "Cancel" }}</button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useBusListener } from "../composables/useBusListener.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";

const path = ref("");
const previewing = ref(false);
const fileContent = ref<Record<string, any> | null>(null);
const { copied, copy } = useCopyFeedback();

function close() {
  path.value = "";
  fileContent.value = null;
  previewing.value = false;
}

useBusListener("terminal:path", (detail) => {
  path.value = detail.path;
  fileContent.value = detail.fileContent;
  previewing.value = false;
  copied.value = false;
});
</script>

<style scoped>
.path-preview-dialog {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
}

.path-preview-dialog-open {
  max-width: none;
  width: calc(100vw - 16px);
  height: calc(var(--app-dvh) - 16px);
  max-height: none;
}

.path-preview-path {
  font-size: 11px;
  color: var(--text-muted);
  white-space: normal;
  word-break: break-all;
}

.path-preview-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  padding: 6px;
}

.path-preview-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.path-preview-buttons-row {
  flex-direction: row;
  margin-top: 0;
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
  margin-top: 2px;
}

.path-preview-buttons-row .path-preview-btn-cancel {
  margin-top: 0;
}
</style>
