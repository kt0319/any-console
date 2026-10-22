<template>
  <li class="diff-inline-body">
    <FileTextViewer v-if="shownNewFileContent" :fileContent="shownNewFileContent" :fileName="path" />
    <pre v-else-if="chunkHtml" class="diff-inline-content" v-html="chunkHtml"></pre>
    <div v-else class="file-content-message">{{ loaded ? "No diff" : "Loading" }}</div>
  </li>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useApi } from "../composables/useApi.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { colorDiff } from "../utils/diff-color.ts";
import { workspaceFileContentPath } from "../utils/endpoints.ts";
import { isNewFileDiffStatus } from "../utils/git.ts";

const props = defineProps<{ path: string, status: string, chunk?: string, content?: Record<string, any> }>();

const workspaceStore = useWorkspaceStore();
const { apiGet } = useApi();

const newFileContent = ref<Record<string, any> | null>(null);
const shownNewFileContent = computed(() => props.content ?? newFileContent.value);
const loaded = ref(false);
const chunkHtml = computed(() => (props.chunk ? colorDiff(props.chunk) : ""));

onMounted(async () => {
  const workspace = workspaceStore.selectedWorkspace;
  const isNewFile = isNewFileDiffStatus(props.status);
  if (!chunkHtml.value && isNewFile && workspace && !props.content) {
    const { ok, data } = await getWithRetry(apiGet, workspaceFileContentPath(workspace, props.path));
    if (ok && data) newFileContent.value = data;
  }
  loaded.value = true;
});
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
