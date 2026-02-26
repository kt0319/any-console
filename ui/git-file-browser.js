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

function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildBreadcrumbHtml(parts) {
  const rootLabel = selectedWorkspace || "~";
  let html = '<div class="file-browser-header">';
  html += `<button type="button" class="file-browser-crumb" data-path="">${escapeHtml(rootLabel)}/</button>`;
  for (let i = 0; i < parts.length; i++) {
    const subPath = parts.slice(0, i + 1).join("/");
    html += '<span class="file-browser-crumb-sep">/</span>';
    if (i === parts.length - 1) {
      html += `<span class="file-browser-crumb-current">${escapeHtml(parts[i])}</span>`;
    } else {
      html += `<button type="button" class="file-browser-crumb" data-path="${escapeHtml(subPath)}">${escapeHtml(parts[i])}</button>`;
    }
  }
  html += '<button type="button" class="file-browser-close">&times;</button>';
  html += "</div>";
  return html;
}

function buildFileBrowserHtml(path, entries) {
  const parts = path ? path.split("/") : [];
  const breadcrumb = buildBreadcrumbHtml(parts);

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

  return `<div class="file-browser">${breadcrumb}${list}</div>`;
}

function fileBrowserMessage(text, muted = false) {
  const style = muted ? "border-bottom:none;color:var(--text-muted)" : "border-bottom:none";
  return `<div class="file-browser"><div class="file-browser-header" style="${style}">${escapeHtml(text)}</div></div>`;
}

function buildFileContentHtml(path, data) {
  const parts = path.split("/");
  const breadcrumb = buildBreadcrumbHtml(parts);

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
    const ext = path.split(".").pop().toLowerCase();
    const lang = getHighlightLang(ext);
    let codeHtml;
    if (lang && typeof hljs !== "undefined") {
      try {
        codeHtml = hljs.highlight(data.content, { language: lang }).value;
      } catch {
        codeHtml = escapeHtml(data.content);
      }
    } else if (typeof hljs !== "undefined") {
      try {
        const result = hljs.highlightAuto(data.content);
        codeHtml = result.value;
      } catch {
        codeHtml = escapeHtml(data.content);
      }
    } else {
      codeHtml = escapeHtml(data.content);
    }
    body = `<div class="file-content-viewer"><pre class="file-content-code hljs">${codeHtml}</pre></div>`;
  }

  return `<div class="file-browser">${breadcrumb}${body}</div>`;
}

async function loadDirectory(path) {
  if (!selectedWorkspace) return;
  const el = $("frame-file-browser");
  if (!el) return;

  el.innerHTML = fileBrowserMessage("読み込み中...", true);

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/files?path=${encodeURIComponent(path)}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      el.innerHTML = fileBrowserMessage(data.detail || "読み込みに失敗しました");
      return;
    }
    el.innerHTML = buildFileBrowserHtml(data.path, data.entries);
    bindFileBrowserEvents(el);
  } catch (e) {
    el.innerHTML = fileBrowserMessage(e.message);
  }
}

function bindFileBrowserEvents(container) {
  for (const crumb of container.querySelectorAll(".file-browser-crumb")) {
    crumb.addEventListener("click", () => loadDirectory(crumb.dataset.path));
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="dir"]')) {
    item.addEventListener("click", () => loadDirectory(item.dataset.path));
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="file"]')) {
    item.addEventListener("click", () => loadFileContent(item.dataset.path));
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="symlink"]')) {
    item.addEventListener("click", () => openSymlinkFromList(item, loadDirectory, loadFileContent));
  }
  const closeBtn = container.querySelector(".file-browser-close");
  if (closeBtn) closeBtn.addEventListener("click", () => removeTab("file-browser"));
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
  else if (targetType === "file") openFileFn(targetPath);
}

async function loadFileContent(path) {
  if (!selectedWorkspace) return;
  const el = $("frame-file-browser");
  if (!el) return;

  el.innerHTML = fileBrowserMessage("読み込み中...", true);

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/file-content?path=${encodeURIComponent(path)}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      el.innerHTML = fileBrowserMessage(data.detail || "読み込みに失敗しました");
      return;
    }
    el.innerHTML = buildFileContentHtml(path, data);
    bindFileBrowserEvents(el);
  } catch (e) {
    el.innerHTML = fileBrowserMessage(e.message);
  }
}

function openFileBrowser() {
  if (!selectedWorkspace) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const wsIcon = ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null;
  const folderIcon = { name: "mdi-folder", color: "" };
  setOutputTab("file-browser", "ファイル", fileBrowserMessage("読み込み中...", true), folderIcon, wsIcon, selectedWorkspace);
  loadDirectory("");
}

async function loadDirectoryInModal(path) {
  if (!selectedWorkspace) return;
  const el = $("commit-modal-file-browser");
  if (!el) return;

  el.innerHTML = fileBrowserMessage("読み込み中...", true);

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/files?path=${encodeURIComponent(path)}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      el.innerHTML = fileBrowserMessage(data.detail || "読み込みに失敗しました");
      return;
    }
    el.innerHTML = buildFileBrowserHtml(path, data.entries);
    bindFileBrowserEventsInModal(el);
  } catch (e) {
    el.innerHTML = fileBrowserMessage(e.message);
  }
}

async function loadFileContentInModal(path) {
  if (!selectedWorkspace) return;
  const el = $("commit-modal-file-browser");
  if (!el) return;

  el.innerHTML = fileBrowserMessage("読み込み中...", true);

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/file-content?path=${encodeURIComponent(path)}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      el.innerHTML = fileBrowserMessage(data.detail || "読み込みに失敗しました");
      return;
    }
    el.innerHTML = buildFileContentHtml(path, data);
    bindFileBrowserEventsInModal(el);
  } catch (e) {
    el.innerHTML = fileBrowserMessage(e.message);
  }
}

function bindFileBrowserEventsInModal(container) {
  for (const crumb of container.querySelectorAll(".file-browser-crumb")) {
    crumb.addEventListener("click", () => loadDirectoryInModal(crumb.dataset.path));
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="dir"]')) {
    item.addEventListener("click", () => loadDirectoryInModal(item.dataset.path));
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="file"]')) {
    item.addEventListener("click", () => loadFileContentInModal(item.dataset.path));
  }
  for (const item of container.querySelectorAll('.file-browser-item[data-type="symlink"]')) {
    item.addEventListener("click", () => openSymlinkFromList(item, loadDirectoryInModal, loadFileContentInModal));
  }
  const closeBtn = container.querySelector(".file-browser-close");
  if (closeBtn) closeBtn.style.display = "none";
}
