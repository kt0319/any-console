// @ts-check
import { token, selectedWorkspace } from './state-core.js';
import { workspaceApiPath } from './api-client.js';
import { showToast } from './utils.js';
import { handleUnauthorized } from './auth.js';

/**
 * Uploads a single file to the specified workspace directory.
 * @param {string} workspaceName - The workspace name.
 * @param {string} dirPath - The target directory path within the workspace.
 * @param {File} file - The file to upload.
 * @param {{ silentSuccess?: boolean }} [options] - Upload options.
 * @returns {Promise<boolean>} True if upload succeeded, false otherwise.
 */
export async function uploadFileToWorkspaceDir(workspaceName, dirPath, file, options = {}) {
  if (!workspaceName || !file) return false;
  const { silentSuccess = false } = options;
  const form = new FormData();
  form.append("path", dirPath || "");
  form.append("file", file);
  try {
    const res = await fetch(workspaceApiPath(workspaceName, "/upload"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return false;
    }
    let data = {};
    try {
      data = await res.json();
    } catch {}
    if (!res.ok || data.status !== "ok") {
      showToast(data.detail || "アップロードに失敗しました");
      return false;
    }
    if (!silentSuccess) {
      showToast(`アップロード完了: ${file.name}`, "success");
    }
    return true;
  } catch (e) {
    showToast(e.message || "アップロードに失敗しました");
    return false;
  }
}

/**
 * Uploads multiple files to the specified workspace directory.
 * @param {string} workspaceName - The workspace name.
 * @param {string} dirPath - The target directory path within the workspace.
 * @param {FileList | File[]} files - The files to upload.
 * @returns {Promise<boolean>} True if all uploads succeeded, false otherwise.
 */
export async function uploadFilesToWorkspaceDir(workspaceName, dirPath, files) {
  const uploadFiles = Array.from(files || []).filter(Boolean);
  if (!workspaceName || uploadFiles.length === 0) return false;

  let uploadedCount = 0;
  for (const file of uploadFiles) {
    const ok = await uploadFileToWorkspaceDir(workspaceName, dirPath, file, {
      silentSuccess: uploadFiles.length > 1,
    });
    if (!ok) return false;
    uploadedCount += 1;
  }
  if (uploadedCount > 1) {
    showToast(`${uploadedCount}件アップロード完了`, "success");
  }
  return uploadedCount > 0;
}

/**
 * Extracts dropped files from a drag-and-drop event.
 * @param {DragEvent} event - The drag event.
 * @returns {File[]} Array of dropped files.
 */
export function extractDroppedFiles(event) {
  const fileList = event?.dataTransfer?.files;
  if (!fileList || fileList.length === 0) return [];
  return Array.from(fileList).filter((file) => file && file.size >= 0);
}

/**
 * Returns whether the drag event contains file data.
 * @param {DragEvent} event - The drag event.
 * @returns {boolean} True if the event carries files.
 */
export function eventHasFileDrag(event) {
  const transfer = event?.dataTransfer;
  if (!transfer) return false;
  if (transfer.files && transfer.files.length > 0) return true;
  const types = Array.from(transfer.types || []);
  return types.includes("Files");
}

/**
 * Binds drag-and-drop file upload handlers to a target element.
 * @param {HTMLElement} target - The drop target element.
 * @param {{ workspaceName: string, getPath?: () => string, onSuccess?: (dirPath: string, files: File[]) => Promise<void>, activeClass?: string }} [options] - Configuration options.
 * @returns {void}
 */
export function bindWorkspaceUploadDropTarget(target, {
  workspaceName,
  getPath,
  onSuccess,
  activeClass = "drop-active",
} = {}) {
  if (!target || !workspaceName) return;
  let dragDepth = 0;

  function clearActive() {
    dragDepth = 0;
    target.classList.remove(activeClass);
  }

  target.addEventListener("dragenter", (event) => {
    if (!eventHasFileDrag(/** @type {DragEvent} */ (event))) return;
    dragDepth += 1;
    target.classList.add(activeClass);
  });

  target.addEventListener("dragover", (event) => {
    if (!eventHasFileDrag(/** @type {DragEvent} */ (event))) return;
    event.preventDefault();
    /** @type {DragEvent} */ (event).dataTransfer.dropEffect = "copy";
    target.classList.add(activeClass);
  });

  target.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      target.classList.remove(activeClass);
    }
  });

  target.addEventListener("drop", async (event) => {
    const files = extractDroppedFiles(/** @type {DragEvent} */ (event));
    clearActive();
    if (files.length === 0) return;
    event.preventDefault();
    const dirPath = getPath ? getPath() : "";
    const ok = await uploadFilesToWorkspaceDir(workspaceName, dirPath, files);
    if (ok && onSuccess) {
      await onSuccess(dirPath, files);
    }
  });
}

/**
 * Binds file upload button and input events within a container element.
 * @param {HTMLElement} container - The container element with upload button and input.
 * @param {(path: string) => void} loadDirFn - Function to reload the directory after upload.
 * @returns {void}
 */
export function bindFileUploadEvents(container, loadDirFn) {
  const uploadBtn = container.querySelector(".file-browser-upload");
  const uploadInput = container.querySelector(".file-browser-upload-input");
  if (!uploadBtn || !uploadInput) return;
  uploadBtn.addEventListener("click", () => /** @type {HTMLInputElement} */ (uploadInput).click());
  uploadInput.addEventListener("change", async () => {
    const file = /** @type {HTMLInputElement} */ (uploadInput).files && /** @type {HTMLInputElement} */ (uploadInput).files[0];
    const targetPath = /** @type {HTMLElement} */ (uploadBtn).dataset.path || "";
    /** @type {HTMLInputElement} */ (uploadInput).value = "";
    if (!file) return;
    const ok = await uploadFileToWorkspaceDir(selectedWorkspace, targetPath, file);
    if (ok) {
      loadDirFn(targetPath);
    }
  });
}
