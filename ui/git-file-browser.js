const FILE_EXT_MAP = {
  js: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  mjs: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  cjs: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  ts: { icon: "mdi-language-typescript", color: "#3178c6", lang: "typescript" },
  tsx: { icon: "mdi-language-typescript", color: "#3178c6", lang: "typescript" },
  jsx: { icon: "mdi-react", color: "#61dafb", lang: "javascript" },
  py: { icon: "mdi-language-python", color: "#3776ab", lang: "python" },
  pyw: { icon: null, color: null, lang: "python" },
  rb: { icon: "mdi-language-ruby", color: "#cc342d", lang: "ruby" },
  rs: { icon: "mdi-language-rust", color: "#dea584", lang: "rust" },
  go: { icon: "mdi-language-go", color: "#00add8", lang: "go" },
  java: { icon: "mdi-language-java", color: "#e76f00", lang: "java" },
  kt: { icon: "mdi-language-kotlin", color: "#7f52ff", lang: "kotlin" },
  swift: { icon: "mdi-language-swift", color: "#f05138", lang: "swift" },
  c: { icon: "mdi-language-c", color: "#a8b9cc", lang: "c" },
  h: { icon: "mdi-language-c", color: "#a8b9cc", lang: "c" },
  cpp: { icon: "mdi-language-cpp", color: "#00599c", lang: "cpp" },
  cc: { icon: "mdi-language-cpp", color: "#00599c", lang: "cpp" },
  cxx: { icon: null, color: null, lang: "cpp" },
  hpp: { icon: null, color: null, lang: "cpp" },
  cs: { icon: "mdi-language-csharp", color: "#239120", lang: "csharp" },
  php: { icon: "mdi-language-php", color: "#777bb4", lang: "php" },
  html: { icon: "mdi-language-html5", color: "#e34f26", lang: "xml" },
  htm: { icon: "mdi-language-html5", color: "#e34f26", lang: "xml" },
  css: { icon: "mdi-language-css3", color: "#1572b6", lang: "css" },
  scss: { icon: "mdi-sass", color: "#cc6699", lang: "scss" },
  sass: { icon: "mdi-sass", color: "#cc6699", lang: "scss" },
  less: { icon: null, color: null, lang: "less" },
  json: { icon: "mdi-code-json", color: "#f7df1e", lang: "json" },
  yaml: { icon: "mdi-file-cog", color: "#cb171e", lang: "yaml" },
  yml: { icon: "mdi-file-cog", color: "#cb171e", lang: "yaml" },
  toml: { icon: "mdi-file-cog", color: "#9c4121", lang: "ini" },
  ini: { icon: null, color: null, lang: "ini" },
  conf: { icon: null, color: null, lang: "ini" },
  xml: { icon: "mdi-file-xml-box", color: "#e37933", lang: "xml" },
  svg: { icon: "mdi-svg", color: "#ffb13b", lang: "xml" },
  md: { icon: "mdi-language-markdown", color: "#83b5d3", lang: "markdown" },
  markdown: { icon: "mdi-language-markdown", color: "#83b5d3", lang: "markdown" },
  sh: { icon: "mdi-console", color: "#89e051", lang: "bash" },
  bash: { icon: "mdi-console", color: "#89e051", lang: "bash" },
  zsh: { icon: "mdi-console", color: "#89e051", lang: "bash" },
  sql: { icon: "mdi-database", color: "#e38c00", lang: "sql" },
  dockerfile: { icon: "mdi-docker", color: "#2496ed", lang: "dockerfile" },
  makefile: { icon: null, color: null, lang: "makefile" },
  lua: { icon: "mdi-language-lua", color: "#000080", lang: "lua" },
  r: { icon: "mdi-language-r", color: "#276dc3", lang: "r" },
  vue: { icon: "mdi-vuejs", color: "#4fc08d" },
  pl: { icon: null, color: null, lang: "perl" },
  pm: { icon: null, color: null, lang: "perl" },
  ex: { icon: null, color: null, lang: "elixir" },
  exs: { icon: null, color: null, lang: "elixir" },
  erl: { icon: null, color: null, lang: "erlang" },
  hs: { icon: null, color: null, lang: "haskell" },
  vim: { icon: null, color: null, lang: "vim" },
  nginx: { icon: null, color: null, lang: "nginx" },
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
  const entry = FILE_EXT_MAP[ext];
  if (!entry || !entry.icon) return { icon: "mdi-file-outline", color: "" };
  return { icon: entry.icon, color: entry.color || "" };
}

function getHighlightLang(ext) {
  return FILE_EXT_MAP[ext]?.lang || null;
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
  const useLongPress = !ref && selectedWorkspace;
  for (const item of container.querySelectorAll('.file-browser-item[data-type="dir"]')) {
    const handler = () => config.openDirectory(item.dataset.path);
    const isParent = item.querySelector(".file-browser-item-name")?.textContent === "..";
    if (useLongPress && !isParent) {
      bindLongPress(item, {
        onClick: handler,
        onLongPress: () => showFileBrowserActionMenu(item, container, config),
      });
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showFileBrowserActionMenu(item, container, config);
      });
    } else {
      item.addEventListener("click", handler);
    }
  }
  if (typeof config.openFile === "function") {
    for (const item of container.querySelectorAll('.file-browser-item[data-type="file"]')) {
      const handler = () => config.openFile(item.dataset.path);
      if (useLongPress) {
        bindLongPress(item, {
          onClick: handler,
          onLongPress: () => showFileBrowserActionMenu(item, container, config),
        });
        item.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          showFileBrowserActionMenu(item, container, config);
        });
      } else {
        item.addEventListener("click", handler);
      }
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

function closeFileBrowserActionMenus(container) {
  for (const m of container.querySelectorAll(".file-browser-action-menu")) {
    m.remove();
  }
}

function showFileBrowserActionMenu(item, container, config) {
  closeFileBrowserActionMenus(container);
  const filePath = item.dataset.path || "";
  const fileName = filePath.split("/").pop() || "";
  if (!fileName) return;

  const menu = document.createElement("div");
  menu.className = "file-browser-action-menu";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.innerHTML = '<i class="mdi mdi-rename-box"></i> リネーム';
  renameBtn.addEventListener("click", async () => {
    menu.remove();
    const newName = prompt("新しい名前:", fileName);
    if (!newName || newName === fileName) return;
    const parentPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const destPath = parentPath ? `${parentPath}/${newName}` : newName;
    await renameFileInWorkspace(filePath, destPath, config);
  });

  const moveBtn = document.createElement("button");
  moveBtn.type = "button";
  moveBtn.innerHTML = '<i class="mdi mdi-file-move-outline"></i> 移動';
  moveBtn.addEventListener("click", async () => {
    menu.remove();
    const destPath = prompt("移動先パス:", filePath);
    if (!destPath || destPath === filePath) return;
    await renameFileInWorkspace(filePath, destPath, config);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "file-browser-action-delete";
  deleteBtn.innerHTML = '<i class="mdi mdi-delete-outline"></i> 削除';
  deleteBtn.addEventListener("click", async () => {
    menu.remove();
    if (!confirm(`「${fileName}」を削除しますか？`)) return;
    await deleteFileInWorkspace(filePath, config);
  });

  menu.appendChild(renameBtn);
  menu.appendChild(moveBtn);
  menu.appendChild(deleteBtn);
  item.after(menu);

  const closeOnOutsideClick = (e) => {
    if (!menu.contains(e.target) && !item.contains(e.target)) {
      menu.remove();
      document.removeEventListener("click", closeOnOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutsideClick), 0);
}


async function renameFileInWorkspace(src, dest, config) {
  if (!selectedWorkspace) return;
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/rename"), {
      method: "POST",
      body: { src, dest },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showToast(data.detail || "操作に失敗しました");
      return;
    }
    const srcName = src.split("/").pop();
    const destName = dest.split("/").pop();
    const srcDir = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
    const destDir = dest.includes("/") ? dest.slice(0, dest.lastIndexOf("/")) : "";
    const toastMsg = srcDir !== destDir
      ? `${srcName} を ${destDir || "/"} に移動しました`
      : `${srcName} → ${destName} にリネームしました`;
    showToast(toastMsg, "success");
    const parentPath = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
    config.openDirectory(parentPath);
  } catch (e) {
    showToast(e.message || "操作に失敗しました");
  }
}

async function deleteFileInWorkspace(path, config) {
  if (!selectedWorkspace) return;
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/delete-file"), {
      method: "POST",
      body: { path },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showToast(data.detail || "削除に失敗しました");
      return;
    }
    showToast("削除しました", "success");
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    config.openDirectory(parentPath);
  } catch (e) {
    showToast(e.message || "削除に失敗しました");
  }
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
