import { ref, watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { colorDiff, escapeDiffHtml } from "../utils/diff-color.js";
import { workspaceFileContentPath } from "../utils/endpoints.js";

export function useFileDiff({ getDiffFile, getDiffMessage }) {
  const workspaceStore = useWorkspaceStore();
  const gitStore = useGitStore();
  const { apiGet } = useApi();

  const diffHtml = ref("");
  const diffNewFileContent = ref(null);

  watch(getDiffFile, async (file) => {
    diffNewFileContent.value = null;
    if (!file) { diffHtml.value = ""; return; }
    const chunk = gitStore.diffChunks[file];
    if (chunk) {
      diffHtml.value = `<pre>${colorDiff(chunk)}</pre>`;
      return;
    }
    const status = (gitStore.diffFileStatuses[file] || "").trim();
    const workspace = workspaceStore.selectedWorkspace;
    if ((status === "??" || status === "A") && workspace) {
      try {
        const { ok, data } = await getWithRetry(apiGet, workspaceFileContentPath(workspace, file));
        if (ok && data) {
          diffNewFileContent.value = data;
          diffHtml.value = "";
          return;
        }
      } catch {}
    }
    diffHtml.value = "";
  }, { immediate: true });

  watch(getDiffMessage, (msg) => {
    if (msg) {
      diffHtml.value = `<div class="text-muted-center">${escapeDiffHtml(msg)}</div>`;
    }
  }, { immediate: true });

  return {
    diffHtml,
    diffNewFileContent,
  };
}
