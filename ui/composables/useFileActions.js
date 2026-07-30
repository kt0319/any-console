import { useAuthStore } from "../stores/auth.js";
import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { useWorkspace } from "./useWorkspace.js";
import { useWorkspaceFile } from "./useWorkspaceFile.js";
import { useToast } from "./useToast.js";
import { MSG_DELETE_FAILED } from "../utils/constants.js";
import { useConfirm } from "./useConfirm.js";
import { usePrompt } from "./usePrompt.js";

export function useFileActions({ getCurrentPath, getFileContent, navigateToPath }) {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const { apiGet, apiPost, wsEndpoint } = useApi();
  const { downloadWorkspaceFile, deleteWorkspaceFile } = useWorkspaceFile();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();
  const toast = useToast();

  async function renameFile(src, dest, afterPath) {
    await withWorkspace(async (workspace) => {
      const { ok } = await apiPost(wsEndpoint(workspace, "rename"), { src, dest }, { errorMessage: "Rename failed" });
      if (!ok) return;
      toast.success("Renamed");
      await navigateToPath(afterPath ?? getCurrentPath());
    });
  }

  async function downloadFile(filePath) {
    await downloadWorkspaceFile(filePath);
  }

  function baseName(filePath) {
    const idx = filePath.lastIndexOf("/");
    return idx >= 0 ? filePath.slice(idx + 1) : filePath;
  }

  function parentDir(filePath) {
    const idx = filePath.lastIndexOf("/");
    return idx >= 0 ? filePath.slice(0, idx) : "";
  }

  // 現在ブラウズ中のパス（開いているファイル、またはブラウズ中のディレクトリ）を対象にする。
  // どちらも getCurrentPath() がそのフルパスを保持しているため同じロジックで扱える。
  async function renameCurrentPath() {
    const filePath = getCurrentPath();
    if (!filePath) return;
    const fileName = baseName(filePath);
    const newName = await prompt({
      title: "Rename",
      message: `Enter a new name for "${fileName}".`,
      initialValue: fileName,
      placeholder: fileName,
    });
    if (!newName || newName === fileName) return;
    const dir = parentDir(filePath);
    const destPath = dir ? `${dir}/${newName}` : newName;
    await renameFile(filePath, destPath, dir);
  }

  async function moveCurrentPath() {
    const filePath = getCurrentPath();
    if (!filePath) return;
    const destPath = await prompt({
      title: "Move",
      message: "Enter destination path.",
      initialValue: filePath,
      placeholder: filePath,
    });
    if (!destPath || destPath === filePath) return;
    await renameFile(filePath, destPath, parentDir(filePath));
  }

  async function deleteCurrentPath() {
    const filePath = getCurrentPath();
    if (!filePath) return;
    const fileName = baseName(filePath);
    if (!await confirm(`Delete "${fileName}"?`)) return;
    const ok = await deleteWorkspaceFile(filePath, { errorMessage: MSG_DELETE_FAILED });
    if (ok) await navigateToPath(parentDir(filePath));
  }

  const normalizedName = (f) => (f.name || "").normalize("NFC");

  async function fetchExistingNames(workspace, uploadPath) {
    const listing = await getWithRetry(apiGet, wsEndpoint(workspace, `files?path=${encodeURIComponent(uploadPath)}`));
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
    if (successCount > 0) toast.success(`${successCount} file(s) uploaded`);
    if (failCount > 0) toast.error(`${failCount} file(s) failed to upload`);
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
    downloadFile,
    renameCurrentPath, moveCurrentPath, deleteCurrentPath,
    uploadDroppedFiles,
  };
}
