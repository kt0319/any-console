const FILE_ICON_MAP = {
  js: { icon: "mdi-language-javascript", color: "#f7df1e" },
  mjs: { icon: "mdi-language-javascript", color: "#f7df1e" },
  cjs: { icon: "mdi-language-javascript", color: "#f7df1e" },
  ts: { icon: "mdi-language-typescript", color: "#3178c6" },
  tsx: { icon: "mdi-language-typescript", color: "#3178c6" },
  jsx: { icon: "mdi-react", color: "#61dafb" },
  py: { icon: "mdi-language-python", color: "#3776ab" },
  rb: { icon: "mdi-language-ruby", color: "#cc342d" },
  rs: { icon: "mdi-language-rust", color: "#dea584" },
  go: { icon: "mdi-language-go", color: "#00add8" },
  java: { icon: "mdi-language-java", color: "#e76f00" },
  kt: { icon: "mdi-language-kotlin", color: "#7f52ff" },
  swift: { icon: "mdi-language-swift", color: "#f05138" },
  c: { icon: "mdi-language-c", color: "#a8b9cc" },
  h: { icon: "mdi-language-c", color: "#a8b9cc" },
  cpp: { icon: "mdi-language-cpp", color: "#00599c" },
  cc: { icon: "mdi-language-cpp", color: "#00599c" },
  cs: { icon: "mdi-language-csharp", color: "#239120" },
  php: { icon: "mdi-language-php", color: "#777bb4" },
  html: { icon: "mdi-language-html5", color: "#e34f26" },
  htm: { icon: "mdi-language-html5", color: "#e34f26" },
  css: { icon: "mdi-language-css3", color: "#1572b6" },
  scss: { icon: "mdi-sass", color: "#cc6699" },
  sass: { icon: "mdi-sass", color: "#cc6699" },
  json: { icon: "mdi-code-json", color: "#f7df1e" },
  yaml: { icon: "mdi-file-cog", color: "#cb171e" },
  yml: { icon: "mdi-file-cog", color: "#cb171e" },
  toml: { icon: "mdi-file-cog", color: "#9c4121" },
  xml: { icon: "mdi-file-xml-box", color: "#e37933" },
  svg: { icon: "mdi-svg", color: "#ffb13b" },
  md: { icon: "mdi-language-markdown", color: "#83b5d3" },
  markdown: { icon: "mdi-language-markdown", color: "#83b5d3" },
  sh: { icon: "mdi-console", color: "#89e051" },
  bash: { icon: "mdi-console", color: "#89e051" },
  zsh: { icon: "mdi-console", color: "#89e051" },
  sql: { icon: "mdi-database", color: "#e38c00" },
  dockerfile: { icon: "mdi-docker", color: "#2496ed" },
  lua: { icon: "mdi-language-lua", color: "#000080" },
  r: { icon: "mdi-language-r", color: "#276dc3" },
  vue: { icon: "mdi-vuejs", color: "#4fc08d" },
  gitignore: { icon: "mdi-git", color: "#f05032" },
  env: { icon: "mdi-key-variant", color: "#ecd53f" },
  lock: { icon: "mdi-lock", color: "#8b8b8b" },
  png: { icon: "mdi-file-image", color: "#a074c4" },
  jpg: { icon: "mdi-file-image", color: "#a074c4" },
  jpeg: { icon: "mdi-file-image", color: "#a074c4" },
  gif: { icon: "mdi-file-image", color: "#a074c4" },
  webp: { icon: "mdi-file-image", color: "#a074c4" },
  ico: { icon: "mdi-file-image", color: "#a074c4" },
  pdf: { icon: "mdi-file-pdf-box", color: "#e5252a" },
  zip: { icon: "mdi-zip-box", color: "#e5a028" },
  gz: { icon: "mdi-zip-box", color: "#e5a028" },
  tar: { icon: "mdi-zip-box", color: "#e5a028" },
};

function getFileIcon(name) {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : name.toLowerCase();
  return FILE_ICON_MAP[ext] || { icon: "mdi-file-outline", color: "" };
}

const HIGHLIGHT_LANG_MAP = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  jsx: "javascript",
  py: "python", pyw: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash", bash: "bash", zsh: "bash",
  html: "xml", htm: "xml", xml: "xml", svg: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  json: "json",
  yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", conf: "ini",
  md: "markdown", markdown: "markdown",
  sql: "sql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  r: "r",
  lua: "lua",
  pl: "perl", pm: "perl",
  ex: "elixir", exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  vim: "vim",
  nginx: "nginx",
};

function getHighlightLang(ext) {
  return HIGHLIGHT_LANG_MAP[ext] || null;
}

function getHighlightKeyFromPath(path) {
  const name = (path || "").split("/").pop().toLowerCase();
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx + 1) : name;
}

function renderHighlightedTextHtml(content, path) {
  const highlightKey = getHighlightKeyFromPath(path);
  const lang = getHighlightLang(highlightKey);
  if (typeof hljs === "undefined") return escapeHtml(content);
  try {
    return lang
      ? hljs.highlight(content, { language: lang }).value
      : hljs.highlightAuto(content).value;
  } catch {
    return escapeHtml(content);
  }
}

function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileBrowserRootLabel(view = "tab") {
  return selectedWorkspace || "~";
}

function getFileBrowserBadgeLabel(view = "tab") {
  if (
    view === "diff-pane"
    && typeof getActiveDiffRef === "function"
    && getActiveDiffRef()
    && typeof getDiffViewerMode === "function"
    && getDiffViewerMode() === "diff"
  ) {
    return "(差分)";
  }
  return "";
}

function buildBreadcrumbHtml(parts, uploadPath = "", options = {}) {
  const rootLabel = options.rootLabel || selectedWorkspace || "~";
  const badgeLabel = options.badgeLabel || "";
  const badgePath = options.badgePath || "";
  const badgeInteractive = !!options.badgeInteractive;
  const currentPath = options.currentPath || "";
  const currentInteractive = !!options.currentInteractive;
  const downloadPath = options.downloadPath || "";
  let html = '<div class="file-browser-header">';
  html += `<button type="button" class="file-browser-crumb" data-path="">${escapeHtml(rootLabel)}</button>`;
  for (let i = 0; i < parts.length; i++) {
    const subPath = parts.slice(0, i + 1).join("/");
    html += '<span class="file-browser-crumb-sep">/</span>';
    if (i === parts.length - 1) {
      if (currentInteractive && currentPath) {
        html += `<button type="button" class="file-browser-crumb-current-action" data-file-path="${escapeHtml(currentPath)}">${escapeHtml(parts[i])}</button>`;
      } else {
        html += `<span class="file-browser-crumb-current">${escapeHtml(parts[i])}</span>`;
      }
    } else {
      html += `<button type="button" class="file-browser-crumb" data-path="${escapeHtml(subPath)}">${escapeHtml(parts[i])}</button>`;
    }
  }
  if (badgeLabel) {
    if (badgeInteractive && badgePath) {
      html += `<button type="button" class="file-browser-crumb-badge file-browser-crumb-badge-action" data-diff-path="${escapeHtml(badgePath)}">${escapeHtml(badgeLabel)}</button>`;
    } else {
      html += `<span class="file-browser-crumb-badge">${escapeHtml(badgeLabel)}</span>`;
    }
  }
  if (downloadPath) {
    html += `<button type="button" class="file-browser-download" data-path="${escapeHtml(downloadPath)}"><span class="mdi mdi-download"></span></button>`;
  }
  if (!options.hideUpload) {
    html += `<button type="button" class="file-browser-upload" data-path="${escapeHtml(uploadPath)}"><span class="mdi mdi-upload"></span></button>`;
    html += '<input type="file" class="file-browser-upload-input" style="display:none" />';
  }
  html += '<button type="button" class="file-browser-close">&times;</button>';
  html += "</div>";
  return html;
}

function buildFileBrowserHtml(path, entries, options = {}) {
  const parts = path ? path.split("/") : [];
  const breadcrumb = buildBreadcrumbHtml(parts, path || "", options);

  let list = '<ul class="file-browser-list">';
  if (path) {
    const parentPath = parts.slice(0, -1).join("/");
    list += `<li class="file-browser-item" data-type="dir" data-path="${escapeHtml(parentPath)}">` +
      `<span class="file-browser-item-icon dir-icon">..</span>` +
      `<span class="file-browser-item-name">..</span>` +
      `</li>`;
  }
  for (const entry of entries) {
    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    let iconHtml;
    if (entry.type === "dir") {
      iconHtml = '<span class="file-browser-item-icon dir-icon"><i class="mdi mdi-folder"></i></span>';
    } else if (entry.type === "symlink") {
      iconHtml = '<span class="file-browser-item-icon symlink-icon"><i class="mdi mdi-link-variant"></i></span>';
    } else {
      const fi = getFileIcon(entry.name);
      const style = fi.color ? ` style="color:${fi.color}"` : "";
      iconHtml = `<span class="file-browser-item-icon file-icon"${style}><i class="mdi ${fi.icon}"></i></span>`;
    }
    const sizeHtml = entry.type === "file" && entry.size != null
      ? `<span class="file-browser-item-size">${formatFileSize(entry.size)}</span>`
      : "";
    const symlinkAttrs = entry.type === "symlink"
      ? ` data-target-type="${escapeHtml(entry.target_type || "")}" data-target-path="${escapeHtml(entry.target_path || "")}" data-link-target="${escapeHtml(entry.link_target || "")}"`
      : "";
    list += `<li class="file-browser-item" data-type="${entry.type}" data-path="${escapeHtml(entryPath)}"${symlinkAttrs}>` +
      `${iconHtml}` +
      `<span class="file-browser-item-name">${escapeHtml(entry.name)}</span>` +
      sizeHtml +
      `</li>`;
  }
  list += "</ul>";

  return `<div class="file-browser" data-upload-path="${escapeHtml(path || "")}">${breadcrumb}${list}</div>`;
}

function fileBrowserMessage(text, muted = false) {
  const style = muted ? "border-bottom:none;color:var(--text-muted)" : "border-bottom:none";
  return `<div class="file-browser"><div class="file-browser-header" style="${style}">${escapeHtml(text)}</div></div>`;
}

function buildFileContentHtml(path, data, options = {}) {
  const parts = path.split("/");
  const parentPath = parts.slice(0, -1).join("/");
  const breadcrumb = buildBreadcrumbHtml(parts, parentPath, { ...options, downloadPath: path, hideUpload: true });

  let body = "";
  if (data.image) {
    if (data.too_large) {
      body = `<div class="file-content-message">画像が大きすぎるためプレビューできません (${formatFileSize(data.size)})</div>`;
    } else {
      const fileName = parts[parts.length - 1] || "image";
      body = `<div class="file-content-image-wrap"><img class="file-content-image" src="${data.data_url}" alt="${escapeHtml(fileName)}" /></div>`;
    }
  } else if (data.binary) {
    body = `<div class="file-content-message">バイナリファイル (${formatFileSize(data.size)})</div>`;
  } else if (data.too_large) {
    body = `<div class="file-content-message">ファイルが大きすぎます (${formatFileSize(data.size)})</div>`;
  } else {
    const codeHtml = renderHighlightedTextHtml(data.content, path);
    body = `<div class="file-content-viewer text-viewer-box viewer-surface"><pre class="file-content-code text-viewer-box-content viewer-content hljs">${codeHtml}</pre></div>`;
  }

  return `<div class="file-browser" data-upload-path="${escapeHtml(parentPath)}">${breadcrumb}${body}</div>`;
}

function buildDiffContentHtml(path, diffText, options = {}, message = "") {
  const parts = path.split("/");
  const parentPath = parts.slice(0, -1).join("/");
  const breadcrumb = buildBreadcrumbHtml(parts, parentPath, options);
  const note = message
    ? `<div class="file-content-message diff-viewer-message">${escapeHtml(message)}</div>`
    : "";
  return `<div class="file-browser" data-upload-path="${escapeHtml(parentPath)}">${breadcrumb}${note}<pre class="diff-content-code"></pre></div>`;
}

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

function getFileBrowserViewConfig(view) {
  if (view === "diff-pane") {
    return {
      containerId: "diff-content",
      hideCloseButton: true,
      onClose: null,
      openDirectory: loadDirectoryInDiffPane,
      openFile: loadFileContentInDiffPane,
    };
  }
  return {
    containerId: "frame-file-browser",
    hideCloseButton: false,
    onClose: () => removeTab("file-browser"),
    openDirectory: loadDirectory,
    openFile: loadFileContent,
  };
}

function getFileBrowserRef(view) {
  if (view === "diff-pane" && typeof getActiveDiffRef === "function") {
    return getActiveDiffRef() || "";
  }
  return "";
}

function getFileBrowserContainer(view) {
  return $(getFileBrowserViewConfig(view).containerId);
}

function buildFileBrowserQuery(path, view = "tab") {
  const ref = getFileBrowserRef(view);
  return ref
    ? `?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`
    : `?path=${encodeURIComponent(path)}`;
}

function getFileBrowserRenderOptions(view, extra = {}) {
  return {
    rootLabel: getFileBrowserRootLabel(view),
    badgeLabel: getFileBrowserBadgeLabel(view),
    ...extra,
  };
}

async function fetchFileBrowserData(endpoint, path, view = "tab") {
  const query = buildFileBrowserQuery(path, view);
  const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/${endpoint}${query}`));
  if (!res) return { ok: false, message: "読み込みに失敗しました" };
  const data = await res.json();
  if (!res.ok || data.status !== "ok") {
    return { ok: false, message: data.detail || "読み込みに失敗しました" };
  }
  return { ok: true, data };
}

async function fetchDirectoryData(path, view = "tab") {
  return fetchFileBrowserData("files", path, view);
}

async function fetchFileContentData(path, view = "tab") {
  return fetchFileBrowserData("file-content", path, view);
}

function bindFileBrowserEvents(container, view = "tab") {
  const config = getFileBrowserViewConfig(view);
  const ref = getFileBrowserRef(view);
  if (!ref) {
    bindFileUploadEvents(container, config.openDirectory);
  }
  const browser = container.querySelector(".file-browser");
  if (browser && selectedWorkspace && !ref) {
    bindWorkspaceUploadDropTarget(browser, {
      workspaceName: selectedWorkspace,
      getPath: () => browser.dataset.uploadPath || "",
      onSuccess: async (targetPath) => {
        await config.openDirectory(targetPath || "");
      },
      activeClass: "file-browser-drop-active",
    });
  }
  for (const crumb of container.querySelectorAll(".file-browser-crumb")) {
    crumb.addEventListener("click", () => config.openDirectory(crumb.dataset.path));
  }
  for (const crumb of container.querySelectorAll(".file-browser-crumb-current-action[data-file-path]")) {
    crumb.addEventListener("click", () => loadFileContentInDiffPane(crumb.dataset.filePath || ""));
  }
  for (const badge of container.querySelectorAll(".file-browser-crumb-badge-action[data-diff-path]")) {
    badge.addEventListener("click", () => showDiffFileInDiffPane(badge.dataset.diffPath || ""));
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="dir"]')) {
    item.addEventListener("click", () => config.openDirectory(item.dataset.path));
  }
  if (typeof config.openFile === "function") {
    for (const item of container.querySelectorAll('.file-browser-item[data-type="file"]')) {
      item.addEventListener("click", () => config.openFile(item.dataset.path));
    }
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="symlink"]')) {
    item.addEventListener("click", () => openSymlinkFromList(item, config.openDirectory, config.openFile));
  }
  const downloadBtn = container.querySelector(".file-browser-download");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", async () => {
      const dlPath = downloadBtn.dataset.path || "";
      if (!dlPath || !selectedWorkspace) return;
      try {
        const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/download?path=${encodeURIComponent(dlPath)}`));
        if (!res || !res.ok) {
          showToast("ダウンロードに失敗しました");
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = dlPath.split("/").pop() || "download";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        showToast("ダウンロードに失敗しました");
      }
    });
  }
  const closeBtn = container.querySelector(".file-browser-close");
  const uploadBtn = container.querySelector(".file-browser-upload");
  const uploadInput = container.querySelector(".file-browser-upload-input");
  if (ref) {
    if (downloadBtn) downloadBtn.style.display = "none";
    if (uploadBtn) uploadBtn.style.display = "none";
    if (uploadInput) uploadInput.style.display = "none";
  }
  if (!closeBtn) return;
  if (config.hideCloseButton) {
    closeBtn.style.display = "none";
    return;
  }
  if (config.onClose) {
    closeBtn.addEventListener("click", config.onClose);
  }
}

async function loadDirectoryByView(path, view) {
  if (!selectedWorkspace) return;
  const el = getFileBrowserContainer(view);
  if (!el) return;

  el.innerHTML = fileBrowserMessage("読み込み中...", true);

  try {
    const result = await fetchDirectoryData(path, view);
    if (!result.ok) {
      el.innerHTML = fileBrowserMessage(result.message);
      return;
    }
    const data = result.data;
    el.innerHTML = buildFileBrowserHtml(data.path, data.entries, getFileBrowserRenderOptions(view, data));
    bindFileBrowserEvents(el, view);
  } catch (e) {
    el.innerHTML = fileBrowserMessage(e.message);
  }
}

async function loadDirectory(path) {
  await loadDirectoryByView(path, "tab");
}

function openSymlinkFromList(item, openDirFn, openFileFn) {
  const targetType = item.dataset.targetType || "";
  const targetPath = item.dataset.targetPath || "";
  const linkTarget = item.dataset.linkTarget || "";
  if (targetType === "outside") {
    showToast(`リンク先がワークスペース外です: ${linkTarget || "(不明)"}`);
    return;
  }
  if (targetType === "missing") {
    showToast("リンク先が存在しません");
    return;
  }
  if (!targetPath) {
    showToast("リンク先を解決できません");
    return;
  }
  const title = item.querySelector(".file-browser-item-name")?.textContent || "シンボリックリンク";
  const actionLabel = targetType === "dir" ? "フォルダ" : "ファイル";
  if (!confirm(`${title} はシンボリックリンクです。リンク先の${actionLabel}を開きますか？`)) return;
  if (targetType === "dir") openDirFn(targetPath);
  else if (targetType === "file" && typeof openFileFn === "function") openFileFn(targetPath);
}

async function loadFileContent(path) {
  await loadFileContentByView(path, "tab");
}

async function loadDirectoryInDiffPane(path) {
  if (typeof setDiffViewerMode === "function") {
    setDiffViewerMode("file");
  }
  await loadDirectoryByView(path, "diff-pane");
}

async function loadFileContentByView(path, view) {
  if (!selectedWorkspace) return;
  const el = getFileBrowserContainer(view);
  if (!el) return;

  el.innerHTML = fileBrowserMessage("読み込み中...", true);

  try {
    const result = await fetchFileContentData(path, view);
    if (!result.ok) {
      el.innerHTML = fileBrowserMessage(result.message);
      return;
    }
    const data = result.data;
    el.innerHTML = buildFileContentHtml(path, data, getFileBrowserRenderOptions(view, {
      badgePath: path,
      badgeInteractive: view === "diff-pane" && !!getFileBrowserRef(view),
    }));
    bindFileBrowserEvents(el, view);
  } catch (e) {
    el.innerHTML = fileBrowserMessage(e.message);
  }
}

async function loadFileContentInDiffPane(path) {
  if (typeof setDiffViewerMode === "function") {
    setDiffViewerMode("file");
  }
  await loadFileContentByView(path, "diff-pane");
}

function showDiffFileInDiffPane(path) {
  if (!selectedWorkspace || !path) return;
  if (typeof setDiffViewerMode === "function") {
    setDiffViewerMode("diff");
  }
  const el = getFileBrowserContainer("diff-pane");
  if (!el) return;
  const diffText = typeof diffChunks === "object" && diffChunks ? (diffChunks[path] || "") : "";
  el.innerHTML = buildDiffContentHtml(path, diffText, getFileBrowserRenderOptions("diff-pane", {
    currentPath: path,
    currentInteractive: true,
  }), diffText ? "" : "差分を表示できません");
  const pre = el.querySelector(".diff-content-code");
  if (pre) {
    if (diffText && typeof colorDiff === "function") {
      pre.appendChild(colorDiff(diffText));
    } else {
      pre.textContent = diffText || "";
    }
  }
  bindFileBrowserEvents(el, "diff-pane");
  el.scrollTop = 0;
}
