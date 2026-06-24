import { useAuthStore } from "../stores/auth.js";
import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { useToast } from "./useToast.js";
import { triggerBlobDownload } from "../utils/download.js";
import { workspaceDownloadPath } from "../utils/endpoints.js";

export function useWorkspaceFile() {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const { apiCommand, wsEndpoint } = useApi();
  const toast = useToast();

  async function downloadWorkspaceFile(filePath) {
    if (!filePath) return false;
    const result = await withWorkspace(async (workspace) => {
      try {
        const res = await auth.apiFetch(workspaceDownloadPath(workspace, filePath));
        if (!res?.ok) throw new Error();
        const blob = await res.blob();
        triggerBlobDownload(blob, filePath.split("/").pop() || "download");
        return true;
      } catch {
        toast.error("Download failed");
        return false;
      }
    });
    return result ?? false;
  }

  async function deleteWorkspaceFile(filePath, { errorMessage = "Delete failed" } = {}) {
    const result = await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(
        wsEndpoint(workspace, "delete-file"),
        { path: filePath },
        { errorMessage },
      );
      if (ok) toast.success(`Deleted "${filePath.split("/").pop()}"`);
      return ok;
    });
    return result ?? false;
  }

  return { downloadWorkspaceFile, deleteWorkspaceFile };
}
