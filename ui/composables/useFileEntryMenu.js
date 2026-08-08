import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { joinEntryPath } from "../utils/file-browser.js";
import { buildGithubFileUrl } from "../utils/git.js";
import { openExternal } from "../utils/open-external.js";

export function useFileEntryMenu({
  currentPath, fileContent,
  navigateToPath, openFile,
  editorUrlTemplate, openInEditor,
}) {
  const workspaceStore = useWorkspaceStore();

  function openDirInEditor() {
    openInEditor(currentPath.value);
  }

  const openFileGithubUrl = computed(() => {
    const ws = workspaceStore.currentWorkspace;
    if (!ws?.github_url || !currentPath.value || !fileContent.value) return "";
    return buildGithubFileUrl(ws.github_url, ws.branch || "main", currentPath.value);
  });

  function openCurrentFileGithub() {
    openExternal(openFileGithubUrl.value);
  }

  function openCurrentFileInEditor() {
    if (!editorUrlTemplate.value || !currentPath.value) return;
    openInEditor(currentPath.value);
  }

  function onEntryClick(entry) {
    const childPath = joinEntryPath(currentPath.value, entry.name);
    if (entry.type === "dir") {
      navigateToPath(childPath);
    } else if (entry.type === "file") {
      currentPath.value = childPath;
      openFile(childPath);
    }
  }

  return {
    openDirInEditor,
    openFileGithubUrl, openCurrentFileGithub, openCurrentFileInEditor,
    onEntryClick,
  };
}
