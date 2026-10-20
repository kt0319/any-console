import { useAuthStore } from "../stores/auth.ts";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useToast } from "./useToast.ts";
import { emit } from "../app-bridge.ts";
import { triggerBlobDownload } from "../utils/download.ts";
import { extractFilenameFromContentDisposition } from "../utils/content-disposition.ts";
import { workspaceDownloadPath, terminalSessionDownloadPath, terminalSessionDeleteFilePath } from "../utils/endpoints.ts";
import { basename } from "../utils/path.ts";

// getTerminalSessionId が空でない時は、ワークスペース未紐付けの素のターミナルとして
// セッションのカレントディレクトリ（/terminal/sessions/{id}/…）を対象にする。
export function useWorkspaceFile({ getTerminalSessionId = () => "" }: { getTerminalSessionId?: () => string } = {}) {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const { apiCommand, wsEndpoint } = useApi();
  const toast = useToast();

  async function fetchAndSaveDownload(endpoint: string, filePath: string) {
    try {
      const res = await auth.apiFetch(endpoint);
      if (!res?.ok) throw new Error();
      const blob = await res.blob();
      // フォルダをダウンロードした場合、サーバがzip化しfilename="dir.zip"を
      // 返すため、そちらを優先する（filePath由来の名前だと拡張子が付かない）。
      // ワークスペースルート（filePath=""）はサーバが workspace 名を basename
      // として付けたファイル名を返すため、フォールバック名は不要。
      const serverFilename = extractFilenameFromContentDisposition(res.headers?.get?.("content-disposition"));
      triggerBlobDownload(blob, serverFilename || basename(filePath) || "download");
      return true;
    } catch {
      toast.error("Download failed");
      return false;
    }
  }

  async function downloadWorkspaceFile(filePath: string) {
    const sessionId = getTerminalSessionId();
    if (sessionId) return await fetchAndSaveDownload(terminalSessionDownloadPath(sessionId, filePath), filePath);
    const result = await withWorkspace((workspace) => fetchAndSaveDownload(workspaceDownloadPath(workspace, filePath), filePath));
    return result ?? false;
  }

  async function deleteWorkspaceFile(filePath: string, { errorMessage = "Delete failed" }: { errorMessage?: string } = {}) {
    const text = `Deleted ${basename(filePath)}`;
    const sessionId = getTerminalSessionId();
    if (sessionId) {
      const { ok } = await apiCommand(terminalSessionDeleteFilePath(sessionId), { path: filePath }, { errorMessage });
      if (ok) toast.success(text);
      return ok;
    }
    const result = await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(wsEndpoint(workspace, "delete-file"), { path: filePath }, { errorMessage });
      if (ok) emit("files:opDone", { wsName: workspace, text });
      return ok;
    });
    return result ?? false;
  }

  return { downloadWorkspaceFile, deleteWorkspaceFile };
}
