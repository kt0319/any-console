<template>
  <div class="modal-scroll-body">
    <div class="config-file-toolbar">
      <button type="button" class="config-file-btn" @click="download">
        <span class="mdi mdi-download"></span> Download
      </button>
      <button type="button" class="config-file-btn" @click="triggerUpload">
        <span class="mdi mdi-upload"></span> Upload
      </button>
      <input ref="fileInput" type="file" accept=".json" style="display:none" @change="upload" />
    </div>
    <pre class="config-file-code"><code ref="codeEl" class="language-json">{{ jsonText }}</code></pre>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, nextTick } from "vue";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
hljs.registerLanguage("json", json);
import { useApi } from "../composables/useApi.js";
import { emit } from "../app-bridge.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Config File";

const { apiGet, apiPost } = useApi();
const jsonText = ref("");
const fileInput = ref(null);
const codeEl = ref(null);

function highlight() {
  nextTick(() => {
    if (hljs && codeEl.value) hljs.highlightElement(codeEl.value);
  });
}

async function loadConfigFile() {
  try {
    const { ok, data } = await apiGet("/settings/export");
    if (!ok) {
      jsonText.value = "Failed to load config";
      return;
    }
    jsonText.value = JSON.stringify(data, null, 2);
    highlight();
  } catch (e) {
    jsonText.value = e.message;
  }
}

function download() {
  const blob = new Blob([jsonText.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "any-console-config.json";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  emit("toast:show", { message: "Config downloaded", type: "success" });
}

function triggerUpload() {
  if (fileInput.value) {
    fileInput.value.value = "";
    fileInput.value.click();
  }
}

async function upload() {
  const file = fileInput.value?.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const { ok } = await apiPost("/settings/import", data);
    if (!ok) {
      emit("toast:show", { message: "Import failed", type: "error" });
      return;
    }
    emit("toast:show", { message: "Config imported", type: "success" });
    jsonText.value = JSON.stringify(data, null, 2);
    highlight();
    emit("settings:imported");
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
  }
}

onMounted(loadConfigFile);
</script>

<style scoped>
.config-file-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.config-file-btn {
  padding: 8px 16px;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-primary);
  flex: 1;
}

.config-file-code {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px;
  font-family: "Hack Nerd Font", monospace;
  font-size: 12px;
  line-height: 1.4;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow-y: auto;
  box-sizing: border-box;
}

.config-file-code code {
  background: transparent;
  padding: 0;
}
</style>
