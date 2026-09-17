import { computed, type Ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { joinEntryPath } from "../utils/file-browser.ts";
import { buildGitHubFileUrl } from "../utils/git.ts";
import { openExternal } from "../utils/open-external.ts";

export function useFileEntryMenu({
  currentPath, entries, fileContent,
  navigateToPath, openFile,
  editorUrlTemplate, openInEditor,
}: {
  currentPath: Ref<string>,
  entries: Ref<Record<string, any>[]>,
  fileContent: Ref<Record<string, any> | null>,
  navigateToPath: (path: string) => void | Promise<void>,
  openFile: (path: string) => void | Promise<void>,
  editorUrlTemplate: Ref<string>,
  openInEditor: (path?: string) => void,
}) {
  const workspaceStore = useWorkspaceStore();

  function openDirInEditor() {
    openInEditor(currentPath.value);
  }

  // gitignore対象のファイルはGitHub上に存在しないため、開いた直後の
  // entries（親ディレクトリ一覧）と currentPath のファイル名を突き合わせて
  // gitignored:true ならGitHubボタンを出さない。
  const isCurrentFileGitignored = computed(() => {
    const name = currentPath.value.split("/").pop();
    return entries.value.some((e) => e.name === name && e.gitignored);
  });

  const openFileGitHubUrl = computed(() => {
    const ws = workspaceStore.currentWorkspace;
    if (!ws?.github_url || !currentPath.value || !fileContent.value) return "";
    if (isCurrentFileGitignored.value) return "";
    return buildGitHubFileUrl(ws.github_url, ws.branch || "main", currentPath.value);
  });

  function openCurrentFileGitHub() {
    openExternal(openFileGitHubUrl.value);
  }

  function openCurrentFileInEditor() {
    if (!editorUrlTemplate.value || !currentPath.value) return;
    openInEditor(currentPath.value);
  }

  function onEntryClick(entry: { name: string, type: string }) {
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
    openFileGitHubUrl, openCurrentFileGitHub, openCurrentFileInEditor,
    onEntryClick,
  };
}
