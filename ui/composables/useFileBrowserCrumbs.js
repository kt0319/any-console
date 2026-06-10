import { computed } from "vue";
import { emit } from "../app-bridge.js";
import { splitPathSegments } from "../utils/file-browser.js";

export function useFileBrowserCrumbs({ getDiffFile, currentPath, fileContent, navigateToPath, openFile }) {
  const displayPathSegments = computed(() => {
    if (getDiffFile()) return splitPathSegments(getDiffFile());
    return splitPathSegments(currentPath.value);
  });

  function onCrumbClick(path) {
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
