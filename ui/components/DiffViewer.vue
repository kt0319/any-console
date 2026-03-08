<template>
  <div class="diff-viewer-pane">
    <div class="diff-content" v-html="diffHtml"></div>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { useGitStore } from "../stores/git.js";

const gitStore = useGitStore();

const props = defineProps({
  file: { type: String, default: "" },
  message: { type: String, default: "" },
});

const diffHtml = ref("");

const DIFF_COLORS = {
  "+": "var(--diff-add, #9ece6a)",
  "-": "var(--diff-del, #f7768e)",
  "@": "var(--diff-hunk, #7aa2f7)",
};

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function colorDiff(text) {
  if (!text) return "";
  return text.split("\n").map((line) => {
    const prefix = line[0];
    const color = DIFF_COLORS[prefix];
    if (color) return `<span style="color:${color}">${escapeHtml(line)}</span>`;
    return escapeHtml(line);
  }).join("\n");
}

watch(() => props.file, (file) => {
  if (!file) {
    diffHtml.value = "";
    return;
  }
  const chunk = gitStore.diffChunks[file];
  if (chunk) {
    diffHtml.value = `<pre>${colorDiff(chunk)}</pre>`;
  } else if (gitStore.diffFullText) {
    diffHtml.value = `<pre>${colorDiff(gitStore.diffFullText)}</pre>`;
  } else {
    diffHtml.value = "";
  }
}, { immediate: true });

watch(() => props.message, (msg) => {
  if (msg) {
    diffHtml.value = `<div style="color:var(--text-muted);padding:16px;text-align:center">${escapeHtml(msg)}</div>`;
  }
}, { immediate: true });
</script>
