import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useWorkspace } from "./useWorkspace.js";
import { useWorkspaceFile } from "./useWorkspaceFile.js";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { openExternal } from "../utils/open-external.js";
import { confirmIrreversible } from "../utils/confirm-irreversible.js";
import { buildGithubFileUrl } from "../utils/git.js";
import { workspaceGitDiscardPath } from "../utils/endpoints.js";
import { basename, dirname } from "../utils/path.js";
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
    openExternal(githubUrl.value);
  }

  function openEditor() {
    if (!editorUrlTemplate.value || !filePath.value) return;
    openInEditor(filePath.value);
  }

  function browseToFolder() {
    if (!filePath.value) return;
    emit("git:browseToFolder", { path: dirname(filePath.value) });
  }

  async function discard() {
    if (!filePath.value) return;
    if (!await confirmIrreversible(confirm, `Discard changes to "${filePath.value}"?`)) return;
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
    if (!await confirmIrreversible(confirm, `Delete "${basename(filePath.value)}"?`)) return;
    const ok = await deleteWorkspaceFile(filePath.value);
    if (ok) emit("git:selectDirty");
  }

  return {
    githubUrl, openGithub, openEditor, browseToFolder, discard, deleteFile,
  };
}
