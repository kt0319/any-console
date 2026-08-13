<template>
  <!-- ターミナルURLアクションダイアログ -->
  <BaseDialog :visible="!!terminalUrl" :z-index="1000" @dismiss="terminalUrl = ''">
    <div class="url-action-dialog" role="dialog" aria-modal="true" aria-label="Open URL">
      <div class="url-action-url">{{ terminalUrl }}</div>
      <div class="url-action-buttons">
        <button class="url-action-btn hover-bg" @click="doUrlOpen">
          <span class="mdi mdi-open-in-new"></span>Open
        </button>
        <button class="url-action-btn hover-bg" @click="doUrlCopy">
          <span class="mdi" :class="copied ? 'mdi-check' : 'mdi-content-copy'"></span>{{ copied ? "Copied!" : "Copy URL" }}
        </button>
        <button class="url-action-btn url-action-btn-cancel hover-bg" @click="terminalUrl = ''">Cancel</button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import BaseDialog from "./BaseDialog.vue";
import { on } from "../app-bridge.ts";
import { useCopyFeedback } from "../composables/useCopyFeedback.ts";
import { openExternal } from "../utils/open-external.ts";

const terminalUrl = ref("");
const { copied, copy } = useCopyFeedback();

function doUrlOpen() {
  openExternal(terminalUrl.value);
  terminalUrl.value = "";
}

async function doUrlCopy() {
  if (!terminalUrl.value) return;
  await copy(terminalUrl.value);
}

onMounted(() => {
  on("terminal:url", ({ uri }) => { terminalUrl.value = uri; copied.value = false; });
});
</script>

<style scoped>
.url-action-dialog {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.url-action-url {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}

.url-action-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.url-action-btn {
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
  width: 100%;
}

.url-action-btn .mdi {
  font-size: 16px;
}

.url-action-btn-cancel {
  color: var(--text-muted);
  margin-top: 2px;
}

</style>
