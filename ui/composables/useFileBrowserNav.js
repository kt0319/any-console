import { ref } from "vue";
import { useApi } from "./useApi.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { getWithRetry } from "../utils/api-retry.ts";
import {
  terminalSessionFileContentPath,
  terminalSessionFilesPath,
  workspaceFileContentPath,
  workspaceFilesPath,
} from "../utils/endpoints.ts";

export function useFileBrowserNav({ getTerminalSessionId = () => "" } = {}) {
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi();

  const currentPath = ref("");
  const entries = ref([]);
  const fileContent = ref(null);
  const isLoading = ref(false);
  const errorMessage = ref("");
  const showHistory = ref(false);

  function resolveListEndpoint(path) {
    const sessionId = getTerminalSessionId();
    if (sessionId) return terminalSessionFilesPath(sessionId, path);

    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return "";
    return workspaceFilesPath(workspace, path);
  }

  function resolveFileEndpoint(path) {
    const sessionId = getTerminalSessionId();
    if (sessionId) return terminalSessionFileContentPath(sessionId, path);

    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return "";
    return workspaceFileContentPath(workspace, path);
  }

  async function navigateToPath(path) {
    const endpoint = resolveListEndpoint(path);
    if (!endpoint) return;

    currentPath.value = path;
    fileContent.value = null;
    showHistory.value = false;
    isLoading.value = true;
    errorMessage.value = "";

    try {
      const { ok, data } = await getWithRetry(apiGet, endpoint);
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
    const endpoint = resolveFileEndpoint(path);
    if (!endpoint) return;

    isLoading.value = true;
    errorMessage.value = "";

    try {
      const { ok, data } = await getWithRetry(apiGet, endpoint);
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
