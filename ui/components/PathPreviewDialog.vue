<template>
  <BaseDialog :visible="!!path" :z-index="1000" @dismiss="close">
    <div class="path-preview-dialog" role="dialog" aria-modal="true" aria-label="File preview">
      <div class="path-preview-path">{{ path }}</div>
      <div class="path-preview-body">
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
import { ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useBusListener } from "../composables/useBusListener.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";

const path = ref("");
const fileContent = ref<Record<string, any> | null>(null);
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
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  width: 100%;
  max-width: 720px;
  max-height: 85vh;
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
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px;
}

.path-preview-buttons {
  display: flex;
  gap: 6px;
}

.path-preview-btn {
  flex: 1;
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
