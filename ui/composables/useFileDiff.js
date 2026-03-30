import { ref, watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { useApi } from "./useApi.js";

const DIFF_COLORS = {
  "+": "var(--diff-add, #9ece6a)",
  "-": "var(--diff-del, #f7768e)",
  "@": "var(--diff-hunk, #7aa2f7)",
};

function escapeDiffHtml(str) {
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
    if (color) return `<span style="color:${color}">${escapeDiffHtml(line)}</span>`;
    return escapeDiffHtml(line);
  }).join("\n");
}

export function useFileDiff({ getDiffFile, getDiffMessage }) {
  const workspaceStore = useWorkspaceStore();
  const gitStore = useGitStore();
  const { apiGet, wsEndpoint } = useApi();

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
    if (status === "??" || status === "A") {
      const workspace = workspaceStore.selectedWorkspace;
      try {
        const { ok, data } = await apiGet(wsEndpoint(workspace, `file-content?path=${encodeURIComponent(file)}`));
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
