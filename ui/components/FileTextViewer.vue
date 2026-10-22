<template>
  <div class="file-viewer">
    <div v-if="fileContent.image && fileContent.data_url" class="file-content-image-box">
      <div
        ref="imageWrapEl"
        class="file-content-image-wrap"
        @touchstart="onImageTouchStart"
        @touchmove="onImageTouchMove"
        @wheel="onImageWheel"
      >
        <img
          :src="fileContent.data_url"
          class="file-content-image"
          :class="{ 'file-content-image-zoomed': zoom !== 1 }"
          :style="zoom !== 1 ? { width: `${zoom * 100}%` } : undefined"
          @click="toggleZoom"
        />
      </div>
    </div>
    <div v-else-if="fileContent.binary" class="file-content-message">Binary file ({{ formatSize(fileContent.size) }})</div>
    <div v-else-if="fileContent.too_large" class="file-content-message">File too large ({{ formatSize(fileContent.size) }})</div>
    <pre v-else ref="codeEl" class="file-content-viewer"><table class="line-table"><tr v-for="(line, i) in highlightedLines" :key="i"><td class="line-num">{{ i + 1 }}</td><td class="line-content" v-html="line"></td></tr></table></pre>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("dockerfile", dockerfile);
import { IMAGE_TAP_ZOOM } from "../utils/constants.ts";
import { pinchDistance, pinchZoom, wheelZoom } from "../utils/pinch-zoom.ts";
import { escapeHtml } from "../utils/escape-html.ts";
import { formatSize } from "../utils/format.ts";

const props = defineProps({
  fileContent: { type: Object, required: true },
  fileName: { type: String, default: "" },
});

const zoom = ref(1);

const imageWrapEl = ref<HTMLElement | null>(null);
let pinchStartZoom = 1;
let pinchStartDistance = 0;

// 拡大率の変更後も、指（カーソル）の下にあった画像上の点が動かないようスクロール位置を補正する。
async function applyZoom(next: number, focalX: number, focalY: number) {
  const wrap = imageWrapEl.value;
  if (!wrap || next === zoom.value) return;
  const ratioX = (wrap.scrollLeft + focalX) / wrap.scrollWidth;
  const ratioY = (wrap.scrollTop + focalY) / wrap.scrollHeight;
  zoom.value = next;
  await nextTick();
  wrap.scrollLeft = ratioX * wrap.scrollWidth - focalX;
  wrap.scrollTop = ratioY * wrap.scrollHeight - focalY;
}

function pinchFocal(wrap: HTMLElement, a: Touch, b: Touch) {
  const rect = wrap.getBoundingClientRect();
  return { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
}

function onImageTouchStart(e: TouchEvent) {
  if (e.touches.length !== 2) return;
  pinchStartZoom = zoom.value;
  pinchStartDistance = pinchDistance(e.touches[0], e.touches[1]);
}

function onImageTouchMove(e: TouchEvent) {
  const wrap = imageWrapEl.value;
  if (!wrap || e.touches.length !== 2) return;
  e.preventDefault();
  const { x, y } = pinchFocal(wrap, e.touches[0], e.touches[1]);
  void applyZoom(pinchZoom(pinchStartZoom, pinchStartDistance, pinchDistance(e.touches[0], e.touches[1])), x, y);
}

function onImageWheel(e: WheelEvent) {
  const wrap = imageWrapEl.value;
  if (!wrap || !e.ctrlKey) return;
  e.preventDefault();
  const rect = wrap.getBoundingClientRect();
  void applyZoom(wheelZoom(zoom.value, e.deltaY), e.clientX - rect.left, e.clientY - rect.top);
}

function toggleZoom() {
  zoom.value = zoom.value === 1 ? IMAGE_TAP_ZOOM : 1;
}

const codeEl = ref<HTMLElement | null>(null);
const highlightedLines = ref<string[]>([]);

function highlight() {
  const content = props.fileContent?.content;
  if (content == null) { highlightedLines.value = []; return; }
  const raw = String(content);
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

watch(() => props.fileContent, () => { zoom.value = 1; highlight(); }, { immediate: true });
</script>

<style scoped>
.file-viewer {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.file-content-viewer {
  display: block;
  flex: 1;
  min-height: 0;
  min-width: 0;
  margin: 0;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 11px;
  line-height: 1.5;
  background: transparent;
  color: var(--text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow-y: auto;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.line-table {
  border-collapse: collapse;
  width: 100%;
}

.line-num {
  user-select: none;
  text-align: right;
  padding-right: 10px;
  color: var(--text-muted);
  opacity: 0.5;
  vertical-align: top;
  white-space: nowrap;
  width: 1px;
}

.line-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.file-content-image-box {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.file-content-image-wrap {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: 12px 0 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
}

.file-content-image {
  margin: 0 auto;
  cursor: zoom-in;
  max-width: 100%;
  max-height: calc(var(--app-dvh) - 200px);
  object-fit: contain;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
}


.file-content-image-zoomed {
  max-width: none;
  max-height: none;
  flex-shrink: 0;
  cursor: zoom-out;
}

.file-content-viewer :deep(code.hljs) {
  background: transparent;
  padding: 0;
}
</style>
