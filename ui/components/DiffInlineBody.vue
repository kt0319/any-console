<template>
  <li class="diff-inline-body">
    <FileTextViewer v-if="content" :fileContent="content" :fileName="path" />
    <pre v-else-if="chunkHtml" class="diff-inline-content" v-html="chunkHtml"></pre>
    <div v-else class="file-content-message">No diff</div>
  </li>
</template>

<script setup lang="ts">
import { computed } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import { colorDiff } from "../utils/diff-color.ts";

const props = defineProps<{ chunk?: string, path: string, content?: Record<string, any> }>();

const chunkHtml = computed(() => (props.chunk ? colorDiff(props.chunk) : ""));
</script>

<style scoped>
.diff-inline-body {
  list-style: none;
  overflow-x: auto;
}

.diff-inline-content {
  margin: 0;
  padding: 8px 12px;
  font-size: 11px;
  line-height: 1.5;
  width: max-content;
  min-width: 100%;
  box-sizing: border-box;
}
</style>
