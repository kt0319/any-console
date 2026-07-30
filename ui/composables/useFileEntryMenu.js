import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLongPress } from "./useLongPress.js";
import { isHoverDevice } from "./useHoverMenu.js";
import { joinEntryPath, buildGithubEntryUrl } from "../utils/file-browser.js";

export function useFileEntryMenu({
  currentPath, fileContent, showHistory,
  navigateToPath, openFile,
  contextEntry, openContextMenu, closeContextMenu,
  editorUrlTemplate, openInEditor,
}) {
  const workspaceStore = useWorkspaceStore();
  const longPress = useLongPress();

  const githubEntryUrl = computed(() => buildGithubEntryUrl(
    workspaceStore.currentWorkspace, currentPath.value, contextEntry.value,
  ));

  function onLongPressStart(e, entry) {
    if (isHoverDevice) return;
    longPress.startMenu(e, entry);
  }

  function onLongPressEnd() {
    if (isHoverDevice) return;
    longPress.endMenu();
    if (longPress.activeEntry.value && longPress.activeEntry.value !== contextEntry.value) {
      contextEntry.value = longPress.activeEntry.value;
      longPress.activeEntry.value = null;
    }
  }

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

  function openEntryHistory() {
    const entry = contextEntry.value;
    if (!entry || entry.type !== "file") return;
    const filePath = joinEntryPath(currentPath.value, entry.name);
    closeContextMenu();
    currentPath.value = filePath;
    fileContent.value = null;
    showHistory.value = true;
  }

  function openEntryInEditor() {
    const entry = contextEntry.value;
    if (!entry) return;
    const filePath = joinEntryPath(currentPath.value, entry.name);
    closeContextMenu();
    if (!editorUrlTemplate.value) {
      currentPath.value = filePath;
      openFile(filePath);
      return;
    }
    openInEditor(filePath);
  }

  function openDirInEditor() {
    openInEditor(currentPath.value);
  }

  function onEntryClick(entry) {
    if (longPress.getMenuEl() || longPress.isFired()) {
      return;
    }
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
    onLongPressStart, onLongPressEnd,
    toggleContextMenu,
    openGitHub,
    openEntry, openEntryHistory, openEntryInEditor, openDirInEditor,
    onEntryClick,
  };
}
