import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { joinEntryPath } from "../utils/file-browser.js";

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
    const branch = ws.branch || "main";
    return `${ws.github_url}/blob/${branch}/${currentPath.value}`;
  });

  function openCurrentFileGithub() {
    if (openFileGithubUrl.value) window.open(openFileGithubUrl.value, "_blank");
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
