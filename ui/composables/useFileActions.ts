import { useAuthStore } from "../stores/auth.ts";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useWorkspaceFile } from "./useWorkspaceFile.ts";
import { useToast } from "./useToast.ts";
import { emit } from "../app-bridge.ts";
import { MSG_DELETE_FAILED } from "../utils/constants.ts";
import { useConfirm } from "./useConfirm.ts";
import { confirmIrreversible } from "../utils/confirm-irreversible.ts";
import { usePrompt } from "./usePrompt.ts";
import { splitRelativePath, resolveUploadTargetDir, formatUploadFailures, type UploadFailure } from "../utils/file-upload-path.ts";
import { basename, dirname } from "../utils/path.ts";
import { workspaceFilesPath, terminalSessionFilesPath, terminalSessionUploadPath } from "../utils/endpoints.ts";

type DroppedEntry = { file: File, relativePath: string };

// アップロード先。ワークスペースは /workspaces/{name}/…、ワークスペース未紐付けの
// 素のターミナルはセッションのカレントディレクトリ（/terminal/sessions/{id}/…）。
type UploadTarget = {
  uploadEndpoint: string,
  listingPath: (dir: string) => string,
  reportSuccess: (count: number) => void,
};

export function useFileActions({ getCurrentPath, getFileContent, navigateToPath, getTerminalSessionId = () => "" }: {
  getCurrentPath: () => string,
  getFileContent: () => unknown,
  navigateToPath: (path: string) => Promise<void>,
  getTerminalSessionId?: () => string,
}) {
  const auth = useAuthStore();
  const { withWorkspace } = useWorkspace();
  const { apiGet, apiPost, wsEndpoint } = useApi();
  const { downloadWorkspaceFile, deleteWorkspaceFile } = useWorkspaceFile();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();
  const toast = useToast();

  async function renameFile(src: string, dest: string, afterPath?: string) {
    await withWorkspace(async (workspace) => {
      const { ok } = await apiPost(wsEndpoint(workspace, "rename"), { src, dest }, { errorMessage: "Rename failed" });
      if (!ok) return;
      emit("files:opDone", { wsName: workspace, text: `Renamed ${basename(dest)}` });
      await navigateToPath(afterPath ?? getCurrentPath());
    });
  }

  async function downloadFile(filePath: string) {
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

  const normalizedName = (f: File) => (f.name || "").normalize("NFC");

  async function fetchExistingNames(target: UploadTarget, uploadPath: string) {
    const listing = await getWithRetry(apiGet, target.listingPath(uploadPath));
    const names = new Set<string>();
    if (listing.ok && listing.data?.entries) {
      for (const e of listing.data.entries) names.add(e.name);
    }
    return names;
  }

  async function resolveUploadTargets(files: File[], existing: Set<string>) {
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

  /** 成功時は null、失敗時は理由（サーバの detail、無ければ HTTP ステータス）を返す。 */
  async function uploadOne(target: UploadTarget, uploadPath: string, file: File, overwrite: boolean): Promise<string | null> {
    const formData = new FormData();
    formData.append("path", uploadPath);
    formData.append("file", file);
    if (overwrite) formData.append("overwrite", "true");
    try {
      const res = await auth.apiFetch(target.uploadEndpoint, { method: "POST", body: formData });
      if (!res) return "Unauthorized";
      if (res.ok) return null;
      const body = await res.json().catch(() => null);
      return body?.detail || `HTTP ${res.status}`;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  function emitUploadResult(target: UploadTarget, successCount: number, failures: UploadFailure[], skippedCount: number) {
    if (successCount > 0) target.reportSuccess(successCount);
    if (failures.length > 0) toast.error(formatUploadFailures(failures));
    if (skippedCount > 0) toast.error(`${skippedCount} file(s) skipped (overwrite declined)`);
  }

  // entries: { file: File, relativePath: string }[]。ドロップされたのが
  // フォルダの場合、relativePathにフォルダ階層（例: "src/app.js"）が入る
  // （useFileDragDropのcollectDroppedFileEntries / webkitRelativePath経由）。
  // フォルダ内のファイル（サブディレクトリ持ち）は上書き確認の対象にせず、
  // そのままアップロードする（既存名との衝突チェックは直下ファイルのみ）。
  async function uploadDroppedFiles(entries: DroppedEntry[]) {
    if (entries.length === 0) return;
    const sessionId = getTerminalSessionId();
    if (sessionId) {
      await uploadToTarget({
        uploadEndpoint: terminalSessionUploadPath(sessionId),
        listingPath: (dir) => terminalSessionFilesPath(sessionId, dir),
        reportSuccess: (count) => toast.success(`${count} file(s) uploaded`),
      }, entries);
      return;
    }
    await withWorkspace((workspace) => uploadToTarget({
      uploadEndpoint: wsEndpoint(workspace, "upload"),
      listingPath: (dir) => workspaceFilesPath(workspace, dir),
      reportSuccess: (count) => emit("files:opDone", { wsName: workspace, text: `${count} file(s) uploaded` }),
    }, entries));
  }

  async function uploadToTarget(target: UploadTarget, entries: DroppedEntry[]) {
    const uploadPath = getUploadDirPath();
    const flatEntries = entries.filter((e) => !splitRelativePath(e.relativePath).dir);
    const nestedEntries = entries.filter((e) => splitRelativePath(e.relativePath).dir);

    const existing = flatEntries.length > 0 ? await fetchExistingNames(target, uploadPath) : new Set<string>();
    const { targets, overwrite, skippedCount } = flatEntries.length > 0
      ? await resolveUploadTargets(flatEntries.map((e) => e.file), existing)
      : { targets: [], overwrite: false, skippedCount: 0 };

    let successCount = 0;
    const failures: UploadFailure[] = [];
    for (const file of targets) {
      const reason = await uploadOne(target, uploadPath, file, overwrite);
      if (reason === null) successCount += 1;
      else failures.push({ name: file.name, reason });
    }
    for (const entry of nestedEntries) {
      const { dir } = splitRelativePath(entry.relativePath);
      const targetDir = resolveUploadTargetDir(uploadPath, dir);
      const reason = await uploadOne(target, targetDir, entry.file, false);
      if (reason === null) successCount += 1;
      else failures.push({ name: entry.relativePath, reason });
    }

    emitUploadResult(target, successCount, failures, skippedCount);
    await navigateToPath(uploadPath);
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
