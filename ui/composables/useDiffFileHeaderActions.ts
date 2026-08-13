import { computed } from "vue";
import type { Ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useWorkspaceFile } from "./useWorkspaceFile.ts";
import { useApi } from "./useApi.ts";
import { useConfirm } from "./useConfirm.ts";
import { openExternal } from "../utils/open-external.ts";
import { confirmIrreversible } from "../utils/confirm-irreversible.ts";
import { buildGitHubFileUrl } from "../utils/git.ts";
import { workspaceGitDiscardPath } from "../utils/endpoints.ts";
import { basename, dirname } from "../utils/path.ts";
import { emit } from "../app-bridge.ts";

export function useDiffFileHeaderActions({ filePath, isWorkingTree, commitHash, editorUrlTemplate, openInEditor }: {
  filePath: Ref<string>,
  isWorkingTree: Ref<boolean>,
  commitHash: Ref<string>,
  editorUrlTemplate: Ref<string>,
  openInEditor: (path: string) => void,
}) {
  const workspaceStore = useWorkspaceStore();
  const { withWorkspace } = useWorkspace();
  const { deleteWorkspaceFile } = useWorkspaceFile();
  const { apiCommand } = useApi();
  const { confirm } = useConfirm();

  const githubUrl = computed(() => {
    const ws = workspaceStore.currentWorkspace;
    if (!ws?.github_url || !filePath.value) return "";
    const ref = isWorkingTree.value ? (ws.branch || "main") : (commitHash.value || "");
    return buildGitHubFileUrl(ws.github_url, ref, filePath.value);
  });

  function openGitHub() {
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
    githubUrl, openGitHub, openEditor, browseToFolder, discard, deleteFile,
  };
}
