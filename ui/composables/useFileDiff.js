import { ref, watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.ts";
import { colorDiff, escapeDiffHtml } from "../utils/diff-color.ts";
import { workspaceFileContentPath } from "../utils/endpoints.ts";

export function useFileDiff({ getDiffFile, getDiffMessage, getDiffCommitHash }) {
  const workspaceStore = useWorkspaceStore();
  const gitStore = useGitStore();
  const { apiGet } = useApi();

  const diffHtml = ref("");
  const diffNewFileContent = ref(null);

  // 同じファイルパスが別コミットにも存在する場合、diffFile（パス）だけを
  // watch していると値が変わらず再取得されない（前のコミットの内容が残る）ため、
  // commitHash も合わせて監視して確実に再取得する。
  watch([getDiffFile, getDiffCommitHash], async ([file]) => {
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
