<template>
  <div class="modal-scroll-body">
    <div class="config-file-toolbar">
      <button type="button" class="config-file-btn" @click="download">
        <span class="mdi mdi-download"></span> ダウンロード
      </button>
      <button type="button" class="config-file-btn" @click="triggerUpload">
        <span class="mdi mdi-upload"></span> アップロード
      </button>
      <input ref="fileInput" type="file" accept=".json" style="display:none" @change="upload" />
    </div>
    <pre class="config-file-code"><code ref="codeEl" class="language-json">{{ jsonText }}</code></pre>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, nextTick } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { emit } from "../app-bridge.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "設定ファイル";

const auth = useAuthStore();
const jsonText = ref("");
const fileInput = ref(null);
const codeEl = ref(null);

function highlight() {
  nextTick(() => {
    if (globalThis.hljs && codeEl.value) globalThis.hljs.highlightElement(codeEl.value);
  });
}

async function loadConfigFile() {
  try {
    const res = await auth.apiFetch("/settings/export");
    if (!res || !res.ok) {
      jsonText.value = "設定の取得に失敗しました";
      return;
    }
    const data = await res.json();
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
  emit("toast:show", { message: "設定をダウンロードしました", type: "success" });
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
    const res = await auth.apiFetch("/settings/import", { method: "POST", body: data });
    if (!res || !res.ok) {
      emit("toast:show", { message: "インポートに失敗しました", type: "error" });
      return;
    }
    emit("toast:show", { message: "設定をインポートしました", type: "success" });
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
