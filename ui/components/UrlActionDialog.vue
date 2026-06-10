<template>
  <!-- ターミナルURLアクションダイアログ -->
  <div v-if="terminalUrl" class="url-action-overlay" @click.self="terminalUrl = ''">
    <div class="url-action-dialog">
      <div class="url-action-url">{{ terminalUrl }}</div>
      <div class="url-action-buttons">
        <button class="url-action-btn" @click="doUrlOpen">
          <span class="mdi mdi-open-in-new"></span>Open
        </button>
        <button class="url-action-btn" @click="doUrlCopy">
          <span class="mdi" :class="urlCopied ? 'mdi-check' : 'mdi-content-copy'"></span>{{ urlCopied ? "Copied!" : "Copy URL" }}
        </button>
        <button class="url-action-btn url-action-btn-cancel" @click="terminalUrl = ''">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { on } from "../app-bridge.js";
import { URL_COPIED_RESET_MS } from "../utils/constants.js";

const terminalUrl = ref("");
const urlCopied = ref(false);

function doUrlOpen() {
  if (terminalUrl.value) window.open(terminalUrl.value, "_blank", "noopener,noreferrer");
  terminalUrl.value = "";
}

async function doUrlCopy() {
  if (!terminalUrl.value) return;
  try {
    await navigator.clipboard.writeText(terminalUrl.value);
    urlCopied.value = true;
    setTimeout(() => { urlCopied.value = false; }, URL_COPIED_RESET_MS);
  } catch {
    urlCopied.value = false;
  }
}

onMounted(() => {
  on("terminal:url", ({ uri }) => { terminalUrl.value = uri; urlCopied.value = false; });
});
</script>

<style>
.url-action-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 12px;
  box-sizing: border-box;
}

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

@media (hover: hover) and (pointer: fine) {
  .url-action-btn:hover {
    background: var(--bg-tertiary);
  }
}
</style>
