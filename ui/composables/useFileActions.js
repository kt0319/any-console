import { useAuthStore } from "../stores/auth.js";
import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { useWorkspaceFile } from "./useWorkspaceFile.js";
import { emit } from "../app-bridge.js";
import { MSG_DELETE_FAILED } from "../utils/constants.js";
import { useConfirm } from "./useConfirm.js";
import { usePrompt } from "./usePrompt.js";

export function useFileActions({ getContextEntry, clearContextEntry, getCurrentPath, getFileContent, navigateToPath }) {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const { apiGet, apiPost, wsEndpoint } = useApi();
  const { downloadWorkspaceFile, deleteWorkspaceFile } = useWorkspaceFile();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();

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
    const newName = await prompt({
      title: "Rename",
      message: `Enter a new name for "${fileName}".`,
      initialValue: fileName,
      placeholder: fileName,
    });
    if (!newName || newName === fileName) { clearContextEntry(); return; }
    const parentPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const destPath = parentPath ? `${parentPath}/${newName}` : newName;
    clearContextEntry();
    await renameFile(filePath, destPath);
  }

  async function moveEntry() {
    const filePath = entryPath();
    if (!filePath) return;
    const destPath = await prompt({
      title: "Move",
      message: "Enter destination path.",
      initialValue: filePath,
      placeholder: filePath,
    });
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
    const ok = await deleteWorkspaceFile(filePath, { errorMessage: MSG_DELETE_FAILED });
    if (ok) await navigateToPath(getCurrentPath());
  }

  async function downloadFile(filePath) {
    await downloadWorkspaceFile(filePath);
  }

  async function downloadEntry() {
    const filePath = entryPath();
    if (!filePath) return;
    clearContextEntry();
    await downloadFile(filePath);
  }

  const normalizedName = (f) => (f.name || "").normalize("NFC");

  async function fetchExistingNames(workspace, uploadPath) {
    const listing = await apiGet(wsEndpoint(workspace, `files?path=${encodeURIComponent(uploadPath)}`));
    const names = new Set();
    if (listing.ok && listing.data?.entries) {
      for (const e of listing.data.entries) names.add(e.name);
    }
    return names;
  }

  async function resolveUploadTargets(files, existing) {
    const all = Array.from(files);
    const conflicts = all.filter((f) => existing.has(normalizedName(f)));
    if (conflicts.length === 0) return { targets: all, overwrite: false };

    const names = conflicts.map(normalizedName);
    const list = names.slice(0, 5).join(", ") + (names.length > 5 ? `, … and ${names.length - 5} more` : "");
    const overwrite = (await confirm(`Overwrite existing file(s)? ${list}`)) === true;
    if (overwrite) return { targets: all, overwrite: true };
    return { targets: all.filter((f) => !existing.has(normalizedName(f))), overwrite: false };
  }

  async function uploadOne(workspace, uploadPath, file, overwrite) {
    const formData = new FormData();
    formData.append("path", uploadPath);
    formData.append("file", file);
    if (overwrite) formData.append("overwrite", "true");
    try {
      const res = await auth.apiFetch(wsEndpoint(workspace, "upload"), { method: "POST", body: formData });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  }

  function emitUploadToasts(successCount, failCount) {
    if (successCount > 0) emit("toast:show", { message: `${successCount} file(s) uploaded`, type: "success" });
    if (failCount > 0) emit("toast:show", { message: `${failCount} file(s) failed to upload`, type: "error" });
  }

  async function uploadDroppedFiles(files) {
    if (files.length === 0) return;
    await withWorkspace(async (workspace) => {
      const uploadPath = getUploadDirPath();
      const existing = await fetchExistingNames(workspace, uploadPath);
      const { targets, overwrite } = await resolveUploadTargets(files, existing);
      if (targets.length === 0) return;

      let successCount = 0;
      let failCount = 0;
      for (const file of targets) {
        const ok = await uploadOne(workspace, uploadPath, file, overwrite);
        if (ok) successCount += 1;
        else failCount += 1;
      }

      emitUploadToasts(successCount, failCount);
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
