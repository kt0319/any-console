import { computed } from "vue";

import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { useWorkspaceFile } from "./useWorkspaceFile.js";
import { useToast } from "./useToast.js";
import { useConfirm } from "./useConfirm.js";
import { useLongPress } from "./useLongPress.js";
import { useHoverMenu, isHoverDevice } from "./useHoverMenu.js";
import { copyText } from "../utils/clipboard.js";
import { useEditorIntegration } from "./useEditorIntegration.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { buildGithubFileUrl } from "../utils/git.js";
import { workspaceGitDiscardPath, workspaceCommitMessagePath } from "../utils/endpoints.js";

export function useDiffFileActions({ selectedCommit, reopenWorkingTreeDiff }) {
  const workspaceStore = useWorkspaceStore();
  const { apiCommand, wsEndpoint, apiGet } = useApi();
  const { withWorkspace, getWorkspace } = useWorkspace();
  const { downloadWorkspaceFile } = useWorkspaceFile();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { editorUrlTemplate, fetchEditorSettings, openInEditor } = useEditorIntegration();

  const diffLongPress = useLongPress();
  const {
    contextEntry: diffContextEntry,
    openMenu: openDiffMenu,
    closeMenu: closeDiffMenu,
    onItemMouseEnter: onDiffFileMouseEnter,
    onItemMouseLeave: onDiffFileMouseLeave,
    onMenuMouseEnter: onDiffMenuMouseEnter,
    onMenuMouseLeave: onDiffMenuMouseLeave,
  } = useHoverMenu();

  const isWorkingTreeDiff = computed(() => selectedCommit.value?.hash === "__dirty__");

  const diffMenuActions = computed(() => {
    const file = diffContextEntry.value;
    if (!file) return [];
    return [
      { icon: "mdi-file-document-outline", label: "View diff", handler: () => viewDiffFile(file) },
      { icon: "mdi-file-edit-outline", label: "Editor", show: !!editorUrlTemplate.value, handler: () => { openInEditor(file.path); closeDiffMenu(); } },
      { icon: "mdi-download", label: "Download", handler: () => downloadDiffFile(file) },
      { icon: "mdi-github", label: "GitHub", show: !!diffFileGithubUrl(file), handler: () => openDiffFileGithub(file) },
      { icon: "mdi-undo", label: "Discard", show: isWorkingTreeDiff.value, danger: true, handler: () => discardDiffFile(file) },
      { icon: "mdi-delete-outline", label: "Delete", show: isWorkingTreeDiff.value, danger: true, handler: () => deleteDiffFile(file) },
    ];
  });

  function onDiffFileClick(file) {
    if (!isHoverDevice) {
      if (diffLongPress.consumeFired()) return;
      if (diffContextEntry.value?.path === file.path) {
        closeDiffMenu();
        selectCommitDiffFile(file);
        return;
      }
      openDiffMenu(file);
      return;
    }
    selectCommitDiffFile(file);
  }

  function viewDiffFile(file) {
    closeDiffMenu();
    selectCommitDiffFile(file);
  }

  async function _execDiffFileAction(file, endpoint, errorMessage, successMessage = /** @type {string|null} */ (null)) {
    await withWorkspace(async () => {
      closeDiffMenu();
      const { ok } = await apiCommand(endpoint, { path: file.path }, { errorMessage });
      if (ok) {
        if (successMessage) toast.success(successMessage);
        reopenWorkingTreeDiff();
      }
    });
  }

  async function discardDiffFile(file) {
    await withWorkspace(async (workspace) => {
      await _execDiffFileAction(file, workspaceGitDiscardPath(workspace), `Failed to discard ${file.path}`);
    });
  }

  function openDiffFileGithub(file) {
    const url = diffFileGithubUrl(file);
    if (url) window.open(url, "_blank");
    closeDiffMenu();
  }

  function diffFileGithubUrl(file) {
    const ws = workspaceStore.currentWorkspace;
    if (!ws?.github_url) return "";
    const ref = isWorkingTreeDiff.value
      ? (ws.branch || "main")
      : (selectedCommit.value?.fullHash || "");
    return buildGithubFileUrl(ws.github_url, ref, file.path);
  }

  async function downloadDiffFile(file) {
    closeDiffMenu();
    await downloadWorkspaceFile(file.path);
  }

  async function deleteDiffFile(file) {
    await withWorkspace(async (workspace) => {
      await _execDiffFileAction(file, wsEndpoint(workspace, "delete-file"), "Delete failed", `Deleted "${file.path.split("/").pop()}"`);
    });
  }

  function selectCommitDiffFile(file) {
    bridgeEmit("git:selectDiffFile", { path: file.path });
  }

  async function showSelectedCommitMessage() {
    const entry = selectedCommit.value;
    if (!entry) return;
    if (entry.hash === "__dirty__") return;
    const workspace = getWorkspace();
    if (!workspace) return;
    const { ok, data } = await apiGet(workspaceCommitMessagePath(workspace, entry.fullHash));
    const msg = ok && data?.message ? data.message : entry.message;
    const result = await confirm(`${entry.hash}\n\n${msg}`, {
      extra: { label: "Copy hash", value: "copy", icon: "mdi-content-copy" },
    });
    if (result === "copy") {
      if (await copyText(entry.hash)) {
        toast.success(`Copied ${entry.hash}`);
      } else {
        toast.error("Failed to copy hash");
      }
    }
  }

  return {
    diffLongPress,
    diffContextEntry,
    openDiffMenu,
    onDiffFileMouseEnter,
    onDiffFileMouseLeave,
    onDiffMenuMouseEnter,
    onDiffMenuMouseLeave,
    diffMenuActions,
    onDiffFileClick,
    showSelectedCommitMessage,
    fetchEditorSettings,
  };
}
