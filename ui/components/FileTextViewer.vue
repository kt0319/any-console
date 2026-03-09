<template>
  <div class="file-viewer">
    <div v-if="fileContent.image && fileContent.data_url" class="file-content-image-wrap">
      <img :src="fileContent.data_url" class="file-content-image" />
    </div>
    <div v-else-if="fileContent.binary" class="file-content-message">バイナリファイル ({{ formatSize(fileContent.size) }})</div>
    <div v-else-if="fileContent.too_large" class="file-content-message">ファイルが大きすぎます ({{ formatSize(fileContent.size) }})</div>
    <pre v-else ref="codeEl" class="file-content-viewer"><code>{{ fileContent.content }}</code></pre>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from "vue";

const props = defineProps({
  fileContent: { type: Object, required: true },
  fileName: { type: String, default: "" },
});

const codeEl = ref(null);

function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function highlight() {
  nextTick(() => {
    const el = codeEl.value?.querySelector("code");
    if (!el || !globalThis.hljs) return;
    delete el.dataset.highlighted;
    el.className = "";
    const ext = props.fileName.split(".").pop();
    const lang = ext && globalThis.hljs.getLanguage(ext) ? ext : null;
    if (lang) {
      el.classList.add(`language-${lang}`);
    }
    globalThis.hljs.highlightElement(el);
  });
}

watch(() => props.fileContent, () => highlight(), { immediate: true });
</script>
