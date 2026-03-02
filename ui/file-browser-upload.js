async function uploadFileToWorkspaceDir(workspaceName, dirPath, file, options = {}) {
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

async function uploadFilesToWorkspaceDir(workspaceName, dirPath, files) {
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

function extractDroppedFiles(event) {
  const fileList = event?.dataTransfer?.files;
  if (!fileList || fileList.length === 0) return [];
  return Array.from(fileList).filter((file) => file && file.size >= 0);
}

function eventHasFileDrag(event) {
  const transfer = event?.dataTransfer;
  if (!transfer) return false;
  if (transfer.files && transfer.files.length > 0) return true;
  const types = Array.from(transfer.types || []);
  return types.includes("Files");
}

function bindWorkspaceUploadDropTarget(target, {
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
    if (!eventHasFileDrag(event)) return;
    dragDepth += 1;
    target.classList.add(activeClass);
  });

  target.addEventListener("dragover", (event) => {
    if (!eventHasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    target.classList.add(activeClass);
  });

  target.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      target.classList.remove(activeClass);
    }
  });

  target.addEventListener("drop", async (event) => {
    const files = extractDroppedFiles(event);
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

function bindFileUploadEvents(container, loadDirFn) {
  const uploadBtn = container.querySelector(".file-browser-upload");
  const uploadInput = container.querySelector(".file-browser-upload-input");
  if (!uploadBtn || !uploadInput) return;
  uploadBtn.addEventListener("click", () => uploadInput.click());
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files && uploadInput.files[0];
    const targetPath = uploadBtn.dataset.path || "";
    uploadInput.value = "";
    if (!file) return;
    const ok = await uploadFileToWorkspaceDir(selectedWorkspace, targetPath, file);
    if (ok) {
      loadDirFn(targetPath);
    }
  });
}
