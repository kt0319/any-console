// @ts-check
import { selectedWorkspace, allWorkspaces } from './state-core.js';
import { buildEditorUrl } from './settings.js';
import { diffChunks } from './state-git.js';
import { $, escapeHtml, bindLongPress, showToast } from './utils.js';
import { apiFetch, workspaceApiPath } from './api-client.js';
import { removeTab } from './terminal-tabs.js';
import { colorDiff, getActiveDiffRef, getDiffViewerMode, setDiffViewerMode } from './git-diff.js';
import { bindFileUploadEvents, bindWorkspaceUploadDropTarget } from './file-browser-upload.js';

/**
 * @typedef {{ icon: string | null, color: string | null, lang?: string }} FileExtEntry
 */

/** @type {Record<string, FileExtEntry>} */
export const FILE_EXT_MAP = {
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

/**
 * Returns the MDI icon class and color for a given filename based on its extension.
 * @param {string} name - The filename
 * @returns {{ icon: string, color: string }}
 */
export function getFileIcon(name) {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : name.toLowerCase();
  const entry = FILE_EXT_MAP[ext];
  if (!entry || !entry.icon) return { icon: "mdi-file-outline", color: "" };
  return { icon: entry.icon, color: entry.color || "" };
}

/**
 * Returns the highlight.js language identifier for the given file extension key.
 * @param {string} ext - File extension (without leading dot)
 * @returns {string | null}
 */
export function getHighlightLang(ext) {
  return FILE_EXT_MAP[ext]?.lang || null;
}

/**
 * Derives the file extension key from a file path for highlight.js lookup.
 * @param {string} path - The file path
 * @returns {string}
 */
export function getHighlightKeyFromPath(path) {
  const name = (path || "").split("/").pop().toLowerCase();
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx + 1) : name;
}

/**
 * Renders file content as syntax-highlighted HTML using highlight.js when available,
 * falling back to escaped plain text.
 * @param {string} content - Raw file content
 * @param {string} path - File path used to determine language
 * @returns {string} HTML string
 */
export function renderHighlightedTextHtml(content, path) {
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

/**
 * Formats a byte count as a human-readable string (B / KB / MB).
 * @param {number | null | undefined} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Returns the root breadcrumb label for the file browser, typically the workspace name.
 * @param {string} [view="tab"] - The view context ("tab" or "diff-pane")
 * @returns {string}
 */
export function getFileBrowserRootLabel(view = "tab") {
  return selectedWorkspace || "~";
}

/**
 * Returns a badge label shown next to the breadcrumb when viewing diffs in the diff pane.
 * @param {string} [view="tab"] - The view context ("tab" or "diff-pane")
 * @returns {string}
 */
export function getFileBrowserBadgeLabel(view = "tab") {
  if (
    view === "diff-pane"
    && getActiveDiffRef()
    && getDiffViewerMode() === "diff"
  ) {
    return "(差分)";
  }
  return "";
}

/**
 * Builds the HTML string for the file browser header breadcrumb navigation.
 * @param {string[]} parts - Path segments
 * @param {string} [uploadPath=""] - Path used as data attribute for upload button
 * @param {Object} [options={}] - Additional rendering options
 * @param {string} [options.rootLabel] - Label for the root breadcrumb entry
 * @param {string} [options.badgeLabel] - Text for the optional badge element
 * @param {string} [options.badgePath] - Diff path for interactive badge
 * @param {boolean} [options.badgeInteractive] - Whether the badge is clickable
 * @param {string} [options.currentPath] - File path for interactive current segment
 * @param {boolean} [options.currentInteractive] - Whether the current segment is clickable
 * @param {string} [options.downloadPath] - Path for download button
 * @param {boolean} [options.hideUpload] - Whether to hide the upload button
 * @param {string} [options.editorUrl] - URL to open file in editor
 * @returns {string} HTML string
 */
export function buildBreadcrumbHtml(parts, uploadPath = "", options = {}) {
  const rootLabel = options.rootLabel || selectedWorkspace || "~";
  const badgeLabel = options.badgeLabel || "";
  const badgePath = options.badgePath || "";
  const badgeInteractive = !!options.badgeInteractive;
  const currentPath = options.currentPath || "";
  const currentInteractive = !!options.currentInteractive;
  const downloadPath = options.downloadPath || "";
  const editorUrl = options.editorUrl || "";
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
  if (editorUrl) {
    html += `<a href="${escapeHtml(editorUrl)}" class="file-browser-editor" title="エディタで開く"><span class="mdi mdi-application-edit-outline"></span></a>`;
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

/**
 * Builds the complete HTML for the file browser directory listing.
 * @param {string} path - Current directory path
 * @param {Array<Object>} entries - Directory entries
 * @param {Object} [options={}] - Rendering options forwarded to buildBreadcrumbHtml
 * @returns {string} HTML string
 */
function buildFileBrowserHtml(path, entries, options = {}) {
  const parts = path ? path.split("/") : [];
  const editorUrl = buildEditorUrl(selectedWorkspace);
  const breadcrumb = buildBreadcrumbHtml(parts, path || "", { ...options, editorUrl });

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
    const dimmed = entry.gitignored || entry.type === "symlink";
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
    const nameClass = dimmed ? "file-browser-item-name dimmed" : "file-browser-item-name";
    list += `<li class="file-browser-item" data-type="${entry.type}" data-path="${escapeHtml(entryPath)}"${symlinkAttrs}>` +
      `${iconHtml}` +
      `<span class="${nameClass}">${escapeHtml(entry.name)}</span>` +
      sizeHtml +
      `</li>`;
  }
  list += "</ul>";

  return `<div class="file-browser" data-upload-path="${escapeHtml(path || "")}">${breadcrumb}${list}</div>`;
}

/**
 * Builds a simple file browser wrapper with a single text message.
 * @param {string} text - Message to display
 * @param {boolean} [muted=false] - Whether to style the message as muted/subtle
 * @returns {string} HTML string
 */
function fileBrowserMessage(text, muted = false) {
  const style = muted ? "border-bottom:none;color:var(--text-muted)" : "border-bottom:none";
  return `<div class="file-browser"><div class="file-browser-header" style="${style}">${escapeHtml(text)}</div></div>`;
}

/**
 * Builds the HTML for displaying file content with breadcrumb, syntax highlight, image preview, or binary notice.
 * @param {string} path - File path
 * @param {Object} data - File content data from the API
 * @param {Object} [options={}] - Rendering options forwarded to buildBreadcrumbHtml
 * @returns {string} HTML string
 */
function buildFileContentHtml(path, data, options = {}) {
  const parts = path.split("/");
  const parentPath = parts.slice(0, -1).join("/");
  const editorUrl = buildEditorUrl(selectedWorkspace);
  const breadcrumb = buildBreadcrumbHtml(parts, parentPath, { ...options, hideUpload: true, editorUrl });

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

/**
 * Builds the HTML for the diff content view within the file browser.
 * @param {string} path - File path
 * @param {string} diffText - Raw diff text
 * @param {Object} [options={}] - Rendering options forwarded to buildBreadcrumbHtml
 * @param {string} [message=""] - Optional message shown above the diff
 * @returns {string} HTML string
 */
function buildDiffContentHtml(path, diffText, options = {}, message = "") {
  const parts = path.split("/");
  const parentPath = parts.slice(0, -1).join("/");
  const breadcrumb = buildBreadcrumbHtml(parts, parentPath, options);
  const note = message
    ? `<div class="file-content-message diff-viewer-message">${escapeHtml(message)}</div>`
    : "";
  return `<div class="file-browser" data-upload-path="${escapeHtml(parentPath)}">${breadcrumb}${note}<pre class="diff-content-code"></pre></div>`;
}

/**
 * Returns the view configuration object (container ID, callbacks) for a given file browser view.
 * @param {string} view - The view context ("tab" or "diff-pane")
 * @returns {Object}
 */
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

/**
 * Returns the git ref to use for file browser requests in the given view.
 * @param {string} view - The view context ("tab" or "diff-pane")
 * @returns {string}
 */
function getFileBrowserRef(view) {
  if (view === "diff-pane") {
    return getActiveDiffRef() || "";
  }
  return "";
}

/**
 * Returns the DOM container element for the file browser in the given view.
 * @param {string} view - The view context ("tab" or "diff-pane")
 * @returns {HTMLElement | null}
 */
function getFileBrowserContainer(view) {
  return $(getFileBrowserViewConfig(view).containerId);
}

/**
 * Builds the query string for a file browser API request including path and optional ref.
 * @param {string} path - Directory or file path
 * @param {string} [view="tab"] - The view context
 * @returns {string} Query string starting with "?"
 */
function buildFileBrowserQuery(path, view = "tab") {
  const ref = getFileBrowserRef(view);
  return ref
    ? `?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`
    : `?path=${encodeURIComponent(path)}`;
}

/**
 * Returns the render options object (rootLabel, badgeLabel, plus extras) for a given view.
 * @param {string} view - The view context
 * @param {Object} [extra={}] - Additional options to merge
 * @returns {Object}
 */
function getFileBrowserRenderOptions(view, extra = {}) {
  return {
    rootLabel: getFileBrowserRootLabel(view),
    badgeLabel: getFileBrowserBadgeLabel(view),
    ...extra,
  };
}

/**
 * Fetches file browser data (directory listing or file content) from the API.
 * @param {string} endpoint - API endpoint name ("files" or "file-content")
 * @param {string} path - Path to fetch
 * @param {string} [view="tab"] - The view context
 * @returns {Promise<{ ok: boolean, data?: Object, message?: string }>}
 */
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

/**
 * Fetches directory listing data for the given path and view.
 * @param {string} path - Directory path
 * @param {string} [view="tab"] - The view context
 * @returns {Promise<{ ok: boolean, data?: Object, message?: string }>}
 */
async function fetchDirectoryData(path, view = "tab") {
  return fetchFileBrowserData("files", path, view);
}

/**
 * Fetches file content data for the given path and view.
 * @param {string} path - File path
 * @param {string} [view="tab"] - The view context
 * @returns {Promise<{ ok: boolean, data?: Object, message?: string }>}
 */
async function fetchFileContentData(path, view = "tab") {
  return fetchFileBrowserData("file-content", path, view);
}

/**
 * Triggers a file download for the given workspace-relative path.
 * @param {string} path - File path to download
 */
function handleDownloadClick(path) {
  if (!path || !selectedWorkspace) return;
  apiFetch(workspaceApiPath(selectedWorkspace, `/download?path=${encodeURIComponent(path)}`))
    .then((res) => {
      if (!res || !res.ok) {
        showToast("ダウンロードに失敗しました");
        return null;
      }
      return res.blob();
    })
    .then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(() => showToast("ダウンロードに失敗しました"));
}

/**
 * Finds the closest `.file-browser-item` ancestor of the given event target.
 * @param {EventTarget} target
 * @returns {HTMLElement | null}
 */
function findFileBrowserItem(target) {
  return target.closest(".file-browser-item");
}

/**
 * Attaches all event listeners to the file browser container for a given view.
 * @param {HTMLElement} container - The file browser container element
 * @param {string} [view="tab"] - The view context
 */
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

  const useLongPress = !ref && selectedWorkspace;
  const listEl = container.querySelector(".file-browser-list");
  if (listEl) {
    if (useLongPress) {
      bindLongPress(listEl, {
        onClick: (e) => handleFileListClick(e, config, useLongPress),
        animationTarget: (e) => findFileBrowserItem(e.target),
        onLongPress: (e) => {
          const item = findFileBrowserItem(e.target);
          if (!item) return;
          const isParent = item.querySelector(".file-browser-item-name")?.textContent === "..";
          if (isParent) return;
          showFileBrowserActionMenu(item, container, config);
        },
      });
    } else {
      listEl.addEventListener("click", (e) => handleFileListClick(e, config, false));
    }
  }

  const headerEl = container.querySelector(".file-browser-header");
  if (headerEl) {
    headerEl.addEventListener("click", (e) => {
      const crumb = e.target.closest(".file-browser-crumb");
      if (crumb) {
        config.openDirectory(crumb.dataset.path);
        return;
      }
      const currentAction = e.target.closest(".file-browser-crumb-current-action[data-file-path]");
      if (currentAction) {
        loadFileContentInDiffPane(currentAction.dataset.filePath);
        return;
      }
      const badgeAction = e.target.closest(".file-browser-crumb-badge-action[data-diff-path]");
      if (badgeAction) {
        showDiffFileInDiffPane(badgeAction.dataset.diffPath);
        return;
      }
      const downloadBtn = e.target.closest(".file-browser-download");
      if (downloadBtn) {
        handleDownloadClick(downloadBtn.dataset.path);
        return;
      }
      const closeBtn = e.target.closest(".file-browser-close");
      if (closeBtn && config.onClose) {
        config.onClose();
      }
    });
  }

  const downloadBtn = container.querySelector(".file-browser-download");
  const uploadBtn = container.querySelector(".file-browser-upload");
  const uploadInput = container.querySelector(".file-browser-upload-input");
  const closeBtn = container.querySelector(".file-browser-close");
  if (ref) {
    if (downloadBtn) downloadBtn.style.display = "none";
    if (uploadBtn) uploadBtn.style.display = "none";
    if (uploadInput) uploadInput.style.display = "none";
  }
  if (closeBtn) {
    if (config.hideCloseButton) {
      closeBtn.style.display = "none";
    }
  }
}

/**
 * Handles a click event on the file browser list and delegates to the appropriate open handler.
 * @param {MouseEvent} e
 * @param {Object} config - View config from getFileBrowserViewConfig
 * @param {boolean} useLongPress - Whether long-press mode is active
 */
function handleFileListClick(e, config, useLongPress) {
  const item = findFileBrowserItem(e.target);
  if (!item) return;
  const type = item.dataset.type;
  const path = item.dataset.path;

  if (type === "dir") {
    config.openDirectory(path);
  } else if (type === "file") {
    config.openFile(path);
  } else if (type === "symlink") {
    openSymlinkFromList(item, config.openDirectory, config.openFile);
  }
}

/**
 * Loads a directory listing into the file browser container for the given view.
 * @param {string} path - Directory path to load
 * @param {string} view - The view context ("tab" or "diff-pane")
 */
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

/**
 * Loads a directory listing into the tab-view file browser.
 * @param {string} path - Directory path to load
 */
async function loadDirectory(path) {
  await loadDirectoryByView(path, "tab");
}

/**
 * Handles navigation for symlink items in the file browser list.
 * Shows a confirmation dialog and opens the resolved target.
 * @param {HTMLElement} item - The symlink list item element
 * @param {function(string): void} openDirFn - Function to open a directory
 * @param {function(string): void} openFileFn - Function to open a file
 */
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

/**
 * Loads file content into the tab-view file browser.
 * @param {string} path - File path to load
 */
async function loadFileContent(path) {
  await loadFileContentByView(path, "tab");
}

/**
 * Loads a directory listing into the diff-pane file browser and switches to file view mode.
 * @param {string} path - Directory path to load
 */
export async function loadDirectoryInDiffPane(path) {
  setDiffViewerMode("file");
  await loadDirectoryByView(path, "diff-pane");
}

/**
 * Loads file content into the file browser container for the given view.
 * @param {string} path - File path to load
 * @param {string} view - The view context ("tab" or "diff-pane")
 */
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

/**
 * Loads file content into the diff-pane file browser and switches to file view mode.
 * @param {string} path - File path to load
 */
export async function loadFileContentInDiffPane(path) {
  setDiffViewerMode("file");
  await loadFileContentByView(path, "diff-pane");
}

/**
 * Removes all open action menus within the given container.
 * @param {HTMLElement} container
 */
function closeFileBrowserActionMenus(container) {
  for (const m of container.querySelectorAll(".file-browser-action-menu")) {
    m.remove();
  }
}

/**
 * Displays a contextual action menu (rename, move, delete, download) for a file browser item.
 * @param {HTMLElement} item - The file browser list item element
 * @param {HTMLElement} container - The file browser container element
 * @param {Object} config - View config from getFileBrowserViewConfig
 */
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

  if (item.dataset.type !== "dir") {
    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.innerHTML = '<i class="mdi mdi-download"></i> ダウンロード';
    downloadBtn.addEventListener("click", () => {
      menu.remove();
      handleDownloadClick(filePath);
    });
    menu.appendChild(downloadBtn);
  }

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  if (ws && ws.github_url) {
    const baseUrl = ws.github_url.replace(/\.git$/, "");
    const branch = ws.branch || "main";
    const pathType = item.dataset.type === "dir" ? "tree" : "blob";
    const githubLink = `${baseUrl}/${pathType}/${encodeURIComponent(branch)}/${filePath}`;
    const ghBtn = document.createElement("button");
    ghBtn.type = "button";
    ghBtn.innerHTML = '<i class="mdi mdi-github"></i> GitHub';
    ghBtn.addEventListener("click", () => {
      menu.remove();
      window.open(githubLink, "_blank");
    });
    menu.appendChild(ghBtn);
  }

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


/**
 * Renames or moves a file within the current workspace via the API.
 * @param {string} src - Source path
 * @param {string} dest - Destination path
 * @param {Object} config - View config from getFileBrowserViewConfig
 */
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

/**
 * Deletes a file within the current workspace via the API.
 * @param {string} path - File path to delete
 * @param {Object} config - View config from getFileBrowserViewConfig
 */
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

/**
 * Renders a diff view for the given file path in the diff pane using cached diff chunks.
 * @param {string} path - File path whose diff to display
 */
export function showDiffFileInDiffPane(path) {
  if (!selectedWorkspace || !path) return;
  setDiffViewerMode("diff");
  const el = getFileBrowserContainer("diff-pane");
  if (!el) return;
  const diffText = typeof diffChunks === "object" && diffChunks ? (diffChunks[path] || "") : "";
  el.innerHTML = buildDiffContentHtml(path, diffText, getFileBrowserRenderOptions("diff-pane", {
    currentPath: path,
    currentInteractive: true,
  }), diffText ? "" : "差分を表示できません");
  const pre = el.querySelector(".diff-content-code");
  if (pre) {
    if (diffText) {
      pre.appendChild(colorDiff(diffText));
    } else {
      pre.textContent = diffText || "";
    }
  }
  bindFileBrowserEvents(el, "diff-pane");
  el.scrollTop = 0;
}
