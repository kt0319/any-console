import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import {
  terminalSessionFileContentPath,
  terminalSessionFilesPath,
  workspaceFileContentPath,
  workspaceFilesPath,
} from "../utils/endpoints.ts";

export function useFileBrowserNav({ getTerminalSessionId = () => "" }: {
  getTerminalSessionId?: () => string,
} = {}) {
  const workspaceStore = useWorkspaceStore();
  const { apiGet } = useApi();

  const currentPath = ref("");
  const entries = ref<Record<string, any>[]>([]);
  const fileContent = ref<Record<string, any> | null>(null);
  const isLoading = ref(false);
  const errorMessage = ref("");
  const showHistory = ref(false);

  function resolveListEndpoint(path: string) {
    const sessionId = getTerminalSessionId();
    if (sessionId) return terminalSessionFilesPath(sessionId, path);

    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return "";
    return workspaceFilesPath(workspace, path);
  }

  function resolveFileEndpoint(path: string) {
    const sessionId = getTerminalSessionId();
    if (sessionId) return terminalSessionFileContentPath(sessionId, path);

    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return "";
    return workspaceFileContentPath(workspace, path);
  }

  // navigateToPath / openFile 共通の取得テンプレ（ローディング・エラー整形）。
  async function fetchInto(
    endpoint: string,
    errorText: string,
    label: string,
    apply: (data: any) => void,
  ) {
    isLoading.value = true;
    errorMessage.value = "";
    try {
      const { ok, data } = await getWithRetry(apiGet, endpoint);
      if (!ok) {
        errorMessage.value = errorText;
        return;
      }
      apply(data);
    } catch (e) {
      errorMessage.value = errorText;
      console.error(`FileBrowser ${label} failed:`, e);
    } finally {
      isLoading.value = false;
    }
  }

  async function navigateToPath(path: string) {
    const endpoint = resolveListEndpoint(path);
    if (!endpoint) return;

    currentPath.value = path;
    fileContent.value = null;
    showHistory.value = false;
    await fetchInto(endpoint, "Failed to load", "navigate", (data) => {
      entries.value = data.entries || [];
    });
  }

  async function openFile(path: string) {
    const endpoint = resolveFileEndpoint(path);
    if (!endpoint) return;

    await fetchInto(endpoint, "Could not open file", "openFile", (data) => {
      fileContent.value = data;
    });
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
