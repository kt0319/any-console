<template>
  <div class="file-viewer">
    <div v-if="fileContent.image && fileContent.data_url" class="file-content-image-wrap">
      <img :src="fileContent.data_url" class="file-content-image" />
    </div>
    <div v-else-if="fileContent.binary" class="file-content-message">バイナリファイル ({{ formatSize(fileContent.size) }})</div>
    <div v-else-if="fileContent.too_large" class="file-content-message">ファイルが大きすぎます ({{ formatSize(fileContent.size) }})</div>
    <pre v-else ref="codeEl" class="file-content-viewer"><table class="line-table"><tr v-for="(line, i) in highlightedLines" :key="i"><td class="line-num">{{ i + 1 }}</td><td class="line-content" v-html="line"></td></tr></table></pre>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { escapeHtml } from "../utils/escape-html.js";

const props = defineProps({
  fileContent: { type: Object, required: true },
  fileName: { type: String, default: "" },
});

const codeEl = ref(null);
const highlightedLines = ref([]);

function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function highlight() {
  const content = props.fileContent?.content;
  if (content == null) { highlightedLines.value = []; return; }
  const raw = String(content);
  const hljs = globalThis.hljs;
  if (!hljs) {
    highlightedLines.value = raw.split("\n").map(escapeHtml);
    return;
  }
  const ext = props.fileName.split(".").pop();
  const lang = ext && hljs.getLanguage(ext) ? ext : null;
  let html;
  if (lang) {
    html = hljs.highlight(raw, { language: lang }).value;
  } else {
    html = hljs.highlightAuto(raw).value;
  }
  highlightedLines.value = html.split("\n");
}

watch(() => props.fileContent, () => highlight(), { immediate: true });
</script>
