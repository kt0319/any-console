import { useAuthStore } from "../stores/auth.js";
import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { emit } from "../app-bridge.js";
import { MSG_DELETE_FAILED } from "../utils/constants.js";
import { useConfirm } from "./useConfirm.js";
import { triggerBlobDownload } from "../utils/download.js";
import { workspaceDownloadPath } from "../utils/endpoints.js";

export function useFileActions({ getContextEntry, clearContextEntry, getCurrentPath, getFileContent, navigateToPath }) {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const { apiPost, wsEndpoint } = useApi();
  const { confirm } = useConfirm();

  function entryPath() {
    const entry = getContextEntry();
    if (!entry) return "";
    const cur = getCurrentPath();
    return cur ? `${cur}/${entry.name}` : entry.name;
  }

  async function renameFile(src, dest) {
    await withWorkspace(async (workspace) => {
      const { ok } = await apiPost(wsEndpoint(workspace, "rename"), { src, dest }, { errorMessage: "Rename failed" });
      if (!ok) return;
      emit("toast:show", { message: "Renamed", type: "success" });
      await navigateToPath(getCurrentPath());
    });
  }

  async function renameEntry() {
    const filePath = entryPath();
    const fileName = getContextEntry()?.name;
    if (!filePath || !fileName) return;
    const newName = prompt("New name:", fileName);
    if (!newName || newName === fileName) { clearContextEntry(); return; }
    const parentPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const destPath = parentPath ? `${parentPath}/${newName}` : newName;
    clearContextEntry();
    await renameFile(filePath, destPath);
  }

  async function moveEntry() {
    const filePath = entryPath();
    if (!filePath) return;
    const destPath = prompt("Destination path:", filePath);
    if (!destPath || destPath === filePath) { clearContextEntry(); return; }
    clearContextEntry();
    await renameFile(filePath, destPath);
  }

  async function deleteEntry() {
    const filePath = entryPath();
    const fileName = getContextEntry()?.name;
    if (!filePath || !fileName) return;
    if (!await confirm(`Delete "${fileName}"?`)) { clearContextEntry(); return; }
    clearContextEntry();
    await withWorkspace(async (workspace) => {
      const { ok } = await apiPost(wsEndpoint(workspace, "delete-file"), { path: filePath }, { errorMessage: MSG_DELETE_FAILED });
      if (!ok) return;
      emit("toast:show", { message: "Deleted", type: "success" });
      await navigateToPath(getCurrentPath());
    });
  }

  async function downloadFile(filePath) {
    if (!filePath) return;
    await withWorkspace(async (workspace) => {
      try {
        const res = await auth.apiFetch(workspaceDownloadPath(workspace, filePath));
        if (!res?.ok) throw new Error();
        const blob = await res.blob();
        triggerBlobDownload(blob, filePath.split("/").pop() || "download");
      } catch {
        emit("toast:show", { message: "Download failed", type: "error" });
      }
    });
  }

  async function downloadEntry() {
    const filePath = entryPath();
    if (!filePath) return;
    clearContextEntry();
    await downloadFile(filePath);
  }

  async function uploadDroppedFiles(files) {
    if (files.length === 0) return;
    await withWorkspace(async (workspace) => {
      const uploadPath = getUploadDirPath();
      let successCount = 0;
      let failCount = 0;
      for (const file of files) {
        const formData = new FormData();
        formData.append("path", uploadPath);
        formData.append("file", file);
        try {
          const res = await auth.apiFetch(wsEndpoint(workspace, "upload"), {
            method: "POST",
            body: formData,
          });
          if (res && res.ok) {
            successCount += 1;
          } else {
            failCount += 1;
          }
        } catch {
          failCount += 1;
        }
      }

      if (successCount > 0) {
        emit("toast:show", { message: `${successCount} file(s) uploaded`, type: "success" });
      }
      if (failCount > 0) {
        emit("toast:show", { message: `${failCount} file(s) failed to upload`, type: "error" });
      }
      await navigateToPath(uploadPath);
    });
  }

  function getUploadDirPath() {
    const cur = getCurrentPath();
    if (!getFileContent()) {
      return cur || "";
    }
    const idx = cur.lastIndexOf("/");
    if (idx <= 0) return "";
    return cur.slice(0, idx);
  }

  return {
    renameEntry, moveEntry, deleteEntry,
    downloadFile, downloadEntry,
    uploadDroppedFiles,
  };
}
