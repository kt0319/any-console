import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useWorkspace } from "./useWorkspace.js";
import { useWorkspaceFile } from "./useWorkspaceFile.js";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { buildGithubFileUrl } from "../utils/git.js";
import { workspaceGitDiscardPath } from "../utils/endpoints.js";
import { emit } from "../app-bridge.js";

export function useDiffFileHeaderActions({ filePath, isWorkingTree, commitHash, editorUrlTemplate, openInEditor }) {
  const workspaceStore = useWorkspaceStore();
  const { withWorkspace } = useWorkspace();
  const { deleteWorkspaceFile } = useWorkspaceFile();
  const { apiCommand } = useApi();
  const { confirm } = useConfirm();

  const githubUrl = computed(() => {
    const ws = workspaceStore.currentWorkspace;
    if (!ws?.github_url || !filePath.value) return "";
    const ref = isWorkingTree.value ? (ws.branch || "main") : (commitHash.value || "");
    return buildGithubFileUrl(ws.github_url, ref, filePath.value);
  });

  function openGithub() {
    if (githubUrl.value) window.open(githubUrl.value, "_blank");
  }

  function openEditor() {
    if (!editorUrlTemplate.value || !filePath.value) return;
    openInEditor(filePath.value);
  }

  function browseToFolder() {
    if (!filePath.value) return;
    const parts = filePath.value.split("/");
    parts.pop();
    emit("git:browseToFolder", { path: parts.join("/") });
  }

  async function discard() {
    if (!filePath.value) return;
    if (!await confirm(`Discard changes to "${filePath.value}"?`)) return;
    await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(
        workspaceGitDiscardPath(workspace),
        { path: filePath.value },
        { errorMessage: `Failed to discard ${filePath.value}` },
      );
      if (ok) emit("git:selectDirty");
    });
  }

  async function deleteFile() {
    if (!filePath.value) return;
    if (!await confirm(`Delete "${filePath.value.split("/").pop()}"?`)) return;
    const ok = await deleteWorkspaceFile(filePath.value);
    if (ok) emit("git:selectDirty");
  }

  return {
    githubUrl, openGithub, openEditor, browseToFolder, discard, deleteFile,
  };
}
