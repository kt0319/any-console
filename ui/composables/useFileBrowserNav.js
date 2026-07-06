import { ref } from "vue";
import { useApi } from "./useApi.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { getWithRetry } from "../utils/api-retry.js";

export function useFileBrowserNav() {
  const workspaceStore = useWorkspaceStore();
  const { apiGet, wsEndpoint } = useApi();

  const currentPath = ref("");
  const entries = ref([]);
  const fileContent = ref(null);
  const isLoading = ref(false);
  const errorMessage = ref("");
  const showHistory = ref(false);

  async function navigateToPath(path) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;

    currentPath.value = path;
    fileContent.value = null;
    showHistory.value = false;
    isLoading.value = true;
    errorMessage.value = "";

    try {
      const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, `files?path=${encodeURIComponent(path)}`));
      if (!ok) {
        errorMessage.value = "Failed to load";
        return;
      }
      entries.value = data.entries || [];
    } catch (e) {
      errorMessage.value = "Failed to load";
      console.error("FileBrowser navigate failed:", e);
    } finally {
      isLoading.value = false;
    }
  }

  async function openFile(path) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;

    isLoading.value = true;
    errorMessage.value = "";

    try {
      const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, `file-content?path=${encodeURIComponent(path)}`));
      if (!ok) {
        errorMessage.value = "Could not open file";
        return;
      }
      fileContent.value = data;
    } catch (e) {
      errorMessage.value = "Could not open file";
      console.error("FileBrowser openFile failed:", e);
    } finally {
      isLoading.value = false;
    }
  }

  function toggleHistory() {
    showHistory.value = !showHistory.value;
  }

  return {
    currentPath, entries, fileContent,
    isLoading, errorMessage, showHistory,
    navigateToPath, openFile, toggleHistory,
  };
}
