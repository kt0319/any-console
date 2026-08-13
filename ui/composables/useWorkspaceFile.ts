import { useAuthStore } from "../stores/auth.ts";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useToast } from "./useToast.ts";
import { triggerBlobDownload } from "../utils/download.ts";
import { extractFilenameFromContentDisposition } from "../utils/content-disposition.ts";
import { workspaceDownloadPath } from "../utils/endpoints.ts";
import { basename } from "../utils/path.ts";

export function useWorkspaceFile() {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const { apiCommand, wsEndpoint } = useApi();
  const toast = useToast();

  async function downloadWorkspaceFile(filePath: string) {
    if (!filePath) return false;
    const result = await withWorkspace(async (workspace) => {
      try {
        const res = await auth.apiFetch(workspaceDownloadPath(workspace, filePath));
        if (!res?.ok) throw new Error();
        const blob = await res.blob();
        // フォルダをダウンロードした場合、サーバがzip化しfilename="dir.zip"を
        // 返すため、そちらを優先する（filePath由来の名前だと拡張子が付かない）。
        const serverFilename = extractFilenameFromContentDisposition(res.headers?.get?.("content-disposition"));
        triggerBlobDownload(blob, serverFilename || basename(filePath) || "download");
        return true;
      } catch {
        toast.error("Download failed");
        return false;
      }
    });
    return result ?? false;
  }

  async function deleteWorkspaceFile(filePath: string, { errorMessage = "Delete failed" }: { errorMessage?: string } = {}) {
    const result = await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(
        wsEndpoint(workspace, "delete-file"),
        { path: filePath },
        { errorMessage },
      );
      if (ok) toast.success(`Deleted "${basename(filePath)}"`);
      return ok;
    });
    return result ?? false;
  }

  return { downloadWorkspaceFile, deleteWorkspaceFile };
}
