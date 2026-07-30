import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { joinEntryPath, buildGithubEntryUrl } from "../utils/file-browser.js";

export function useFileEntryMenu({
  currentPath, fileContent,
  navigateToPath, openFile,
  contextEntry, openContextMenu, closeContextMenu,
  editorUrlTemplate, openInEditor,
}) {
  const workspaceStore = useWorkspaceStore();

  const githubEntryUrl = computed(() => buildGithubEntryUrl(
    workspaceStore.currentWorkspace, currentPath.value, contextEntry.value,
  ));

  function toggleContextMenu(entry) {
    if (contextEntry.value?.name === entry.name) closeContextMenu();
    else openContextMenu(entry);
  }

  function openGitHub() {
    if (githubEntryUrl.value) {
      window.open(githubEntryUrl.value, "_blank");
    }
    closeContextMenu();
  }

  function openEntry(entry) {
    closeContextMenu();
    const childPath = joinEntryPath(currentPath.value, entry.name);
    if (entry.type === "dir") {
      navigateToPath(childPath);
    } else if (entry.type === "file") {
      currentPath.value = childPath;
      openFile(childPath);
    }
  }

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
    closeContextMenu();
    const childPath = joinEntryPath(currentPath.value, entry.name);
    if (entry.type === "dir") {
      navigateToPath(childPath);
    } else if (entry.type === "file") {
      currentPath.value = childPath;
      openFile(childPath);
    }
  }

  return {
    githubEntryUrl,
    toggleContextMenu,
    openGitHub,
    openEntry, openDirInEditor,
    openFileGithubUrl, openCurrentFileGithub, openCurrentFileInEditor,
    onEntryClick,
  };
}
