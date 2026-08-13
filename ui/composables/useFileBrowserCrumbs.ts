import { computed, type Ref } from "vue";
import { emit } from "../app-bridge.js";
import { splitPathSegments } from "../utils/file-browser.ts";

export function useFileBrowserCrumbs({ getDiffFile, currentPath, fileContent, navigateToPath, openFile }: {
  getDiffFile: () => string | null,
  currentPath: Ref<string>,
  fileContent: Ref<Record<string, any> | null>,
  navigateToPath: (path: string) => void | Promise<void>,
  openFile: (path: string) => void | Promise<void>,
}) {
  const displayPathSegments = computed(() => {
    if (getDiffFile()) return splitPathSegments(getDiffFile());
    return splitPathSegments(currentPath.value);
  });

  function onCrumbClick(path: string) {
    const diffFile = getDiffFile();
    if (diffFile) {
      emit("git:selectDirty");
      fileContent.value = null;
      currentPath.value = path || "";
      if (path && path === diffFile) {
        openFile(path);
        return;
      }
      navigateToPath(currentPath.value);
      return;
    }
    navigateToPath(path);
  }

  return {
    displayPathSegments,
    onCrumbClick,
  };
}
