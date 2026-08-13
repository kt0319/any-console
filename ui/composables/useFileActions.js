import { useAuthStore } from "../stores/auth.ts";
import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.ts";
import { useWorkspace } from "./useWorkspace.js";
import { useWorkspaceFile } from "./useWorkspaceFile.js";
import { useToast } from "./useToast.js";
import { MSG_DELETE_FAILED } from "../utils/constants.ts";
import { useConfirm } from "./useConfirm.js";
import { confirmIrreversible } from "../utils/confirm-irreversible.ts";
import { usePrompt } from "./usePrompt.js";
import { splitRelativePath, resolveUploadTargetDir } from "../utils/file-upload-path.ts";
import { basename, dirname } from "../utils/path.ts";
import { workspaceFilesPath } from "../utils/endpoints.ts";

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

  // 現在ブラウズ中のパス（開いているファイル、またはブラウズ中のディレクトリ）を対象にする。
  // どちらも getCurrentPath() がそのフルパスを保持しているため同じロジックで扱える。
  // Rename（ファイル名だけ変更）とMove（パスごと変更）は同じrenameFile APIを呼ぶ
  // だけの違いのため、フルパスを編集できる1つの操作に統合する
  // （同じ階層内でファイル名部分だけ書き換えればRenameとして機能する）。
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
    await renameFile(filePath, destPath, dirname(filePath));
  }

  async function deleteCurrentPath() {
    const filePath = getCurrentPath();
    if (!filePath) return;
    const fileName = basename(filePath);
    if (!await confirmIrreversible(confirm, `Delete "${fileName}"?`)) return;
    const ok = await deleteWorkspaceFile(filePath, { errorMessage: MSG_DELETE_FAILED });
    if (ok) await navigateToPath(dirname(filePath));
  }

  const normalizedName = (f) => (f.name || "").normalize("NFC");

  async function fetchExistingNames(workspace, uploadPath) {
    const listing = await getWithRetry(apiGet, workspaceFilesPath(workspace, uploadPath));
    const names = new Set();
    if (listing.ok && listing.data?.entries) {
      for (const e of listing.data.entries) names.add(e.name);
    }
    return names;
  }

  async function resolveUploadTargets(files, existing) {
    const all = Array.from(files);
    const conflicts = all.filter((f) => existing.has(normalizedName(f)));
    if (conflicts.length === 0) return { targets: all, overwrite: false, skippedCount: 0 };

    const names = conflicts.map(normalizedName);
    const list = names.slice(0, 5).join(", ") + (names.length > 5 ? `, … and ${names.length - 5} more` : "");
    const overwrite = (await confirm(`Overwrite existing file(s)? ${list}`)) === true;
    if (overwrite) return { targets: all, overwrite: true, skippedCount: 0 };
    return {
      targets: all.filter((f) => !existing.has(normalizedName(f))),
      overwrite: false,
      skippedCount: conflicts.length,
    };
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

  function emitUploadToasts(successCount, failCount, skippedCount) {
    if (successCount > 0) toast.success(`${successCount} file(s) uploaded`);
    if (failCount > 0) toast.error(`${failCount} file(s) failed to upload`);
    if (skippedCount > 0) toast.error(`${skippedCount} file(s) skipped (overwrite declined)`);
  }

  // entries: { file: File, relativePath: string }[]。ドロップされたのが
  // フォルダの場合、relativePathにフォルダ階層（例: "src/app.js"）が入る
  // （useFileDragDropのcollectDroppedFileEntries / webkitRelativePath経由）。
  // フォルダ内のファイル（サブディレクトリ持ち）は上書き確認の対象にせず、
  // そのままアップロードする（既存名との衝突チェックは直下ファイルのみ）。
  async function uploadDroppedFiles(entries) {
    if (entries.length === 0) return;
    await withWorkspace(async (workspace) => {
      const uploadPath = getUploadDirPath();
      const flatEntries = entries.filter((e) => !splitRelativePath(e.relativePath).dir);
      const nestedEntries = entries.filter((e) => splitRelativePath(e.relativePath).dir);

      const existing = flatEntries.length > 0 ? await fetchExistingNames(workspace, uploadPath) : new Set();
      const { targets, overwrite, skippedCount } = flatEntries.length > 0
        ? await resolveUploadTargets(flatEntries.map((e) => e.file), existing)
        : { targets: [], overwrite: false, skippedCount: 0 };

      let successCount = 0;
      let failCount = 0;
      for (const file of targets) {
        const ok = await uploadOne(workspace, uploadPath, file, overwrite);
        if (ok) successCount += 1;
        else failCount += 1;
      }
      for (const entry of nestedEntries) {
        const { dir } = splitRelativePath(entry.relativePath);
        const targetDir = resolveUploadTargetDir(uploadPath, dir);
        const ok = await uploadOne(workspace, targetDir, entry.file, false);
        if (ok) successCount += 1;
        else failCount += 1;
      }

      emitUploadToasts(successCount, failCount, skippedCount);
      await navigateToPath(uploadPath);
    });
  }

  function getUploadDirPath() {
    const cur = getCurrentPath();
    if (!getFileContent()) {
      return cur || "";
    }
    return dirname(cur);
  }

  return {
    downloadFile,
    moveCurrentPath, deleteCurrentPath,
    uploadDroppedFiles,
  };
}
