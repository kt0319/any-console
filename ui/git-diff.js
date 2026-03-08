// @ts-check

import { selectedWorkspace } from './state-core.js';
import { diffChunks, setDiffChunks, diffFullText, setDiffFullText } from './state-git.js';
import { apiFetch, workspaceApiPath, getActionFailureMessage } from './api-client.js';
import { $, escapeHtml, renderActionButtons, hideFormError, showFormError, showToast } from './utils.js';
import { GitLogModal } from './git-log-modal.js';
import { getFileIcon, showDiffFileInDiffPane, loadDirectoryInDiffPane, loadFileContentInDiffPane } from './git-file-browser.js';
import { refreshCurrentWorkspaceStatus } from './workspace.js';

/** @type {string} */
export let diffViewerMode = "file";

/** @type {string | null} */
export let currentDiffRef = null;

/** @returns {string | null} */
export function getActiveDiffRef() {
  return currentDiffRef;
}

/** @returns {string} */
export function getDiffViewerMode() {
  return diffViewerMode;
}

/** @returns {void} */
export function clearActiveDiffRef() {
  currentDiffRef = null;
  setDiffViewerMode("file");
}

/**
 * @param {string} mode
 * @returns {void}
 */
export function setDiffViewerMode(mode) {
  diffViewerMode = mode === "diff" ? "diff" : "file";
}

/**
 * @param {any[] | null} [actions]
 * @returns {void}
 */
export function initDiffPane(actions = null) {
  const fileList = $("diff-file-list");
  const actionsEl = $("diff-actions");
  fileList.innerHTML = '<div class="file-browser"><div class="file-browser-header"><span class="file-browser-crumb-current">読み込み中...</span></div></div>';
  actionsEl.innerHTML = "";
  actionsEl.style.display = "none";
  closeCommitForm();

  if (Array.isArray(actions) && actions.length > 0) {
    renderActionButtons(actionsEl, actions);
    actionsEl.style.display = "flex";
  }
}

/**
 * @param {string} message
 * @returns {void}
 */
export function showDiffError(message) {
  const fileList = $("diff-file-list");
  fileList.innerHTML = "";
  renderDiffViewerMessage(message || "diff の取得に失敗しました");
}

/**
 * @param {string} message
 * @returns {void}
 */
export function renderDiffViewerMessage(message) {
  const diffContent = $("diff-content");
  diffContent.innerHTML = `<div class="file-content-message diff-viewer-message">${escapeHtml(message || "")}</div>`;
}

/**
 * @param {HTMLElement} fileList
 * @param {any} data
 * @param {{ statusBadgeLeft?: boolean, focusFileBrowser?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function showLoadedDiff(fileList, data, options = {}) {
  const { statusBadgeLeft = false, focusFileBrowser = false } = options;
  renderDiffFileList(fileList, data.files, data.diff || "", { statusBadgeLeft });
  if (Array.isArray(data.files) && data.files.length > 0) {
    if (focusFileBrowser) {
      await selectDiffFile(null);
    }
    return;
  }
  if (focusFileBrowser) {
    await loadDirectoryInDiffPane("");
  }
}

/**
 * @param {string} commitHash
 * @param {string} commitMsg
 * @param {string[]} [branches]
 * @returns {Promise<void>}
 */
export async function openCommitDiffModal(commitHash, commitMsg, branches = []) {
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/diff/${encodeURIComponent(commitHash)}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showToast(getActionFailureMessage(data, "diff の取得に失敗しました"), "error");
      return;
    }
    if (!Array.isArray(data.files) || data.files.length === 0) return;

    setDiffViewerMode("file");
    currentDiffRef = commitHash || null;
    initDiffPane();
    GitLogModal.showDiffPane(commitMsg || "");
    await showLoadedDiff($("diff-file-list"), data);
  } catch (e) {
    showToast(e.message, "error");
  }
}

/**
 * @param {string} text
 * @returns {DocumentFragment | string}
 */
export function colorDiff(text) {
  if (!text) return "";
  const frag = document.createDocumentFragment();
  for (const line of text.split("\n")) {
    const span = document.createElement("span");
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      span.className = "diff-line-header";
    } else if (line.startsWith("@@")) {
      span.className = "diff-line-range";
    } else if (line.startsWith("+")) {
      span.className = "diff-line-add";
    } else if (line.startsWith("-")) {
      span.className = "diff-line-del";
    }
    span.textContent = line;
    frag.appendChild(span);
    frag.appendChild(document.createTextNode("\n"));
  }
  return frag;
}

/**
 * @param {string} diffText
 * @returns {Record<string, string>}
 */
export function splitDiffByFile(diffText) {
  if (!diffText) return {};
  const chunks = {};
  let currentFile = null;
  let currentLines = [];
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (currentFile) chunks[currentFile] = currentLines.join("\n");
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      currentFile = match ? match[1] : line;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentFile) chunks[currentFile] = currentLines.join("\n");
  return chunks;
}

/** @type {Set<string>} */
export const DIFF_NEW_STATUSES = new Set(["??", "A"]);

/**
 * @param {string} status
 * @returns {string}
 */
export function getDiffStatusTone(status) {
  const s = (status || "").toUpperCase();
  if (s === "??" || s === "A") return "add";
  if (s.includes("D")) return "del";
  if (s.includes("R")) return "ren";
  if (s.includes("M")) return "mod";
  return "neutral";
}

/**
 * @param {number} insertions
 * @param {number} deletions
 * @param {string} [extraClass]
 * @returns {string}
 */
export function renderNumstatHtml(insertions, deletions, extraClass = "") {
  const hasIns = Number.isFinite(insertions);
  const hasDel = Number.isFinite(deletions);
  if (!hasIns && !hasDel) return "";
  const ins = hasIns ? insertions : 0;
  const del = hasDel ? deletions : 0;
  const cls = extraClass ? `diff-file-row-numstat ${extraClass}` : "diff-file-row-numstat";
  return `<span class="${cls}"><span class="diff-num-plus">+${ins}</span><span class="diff-num-del">-${del}</span></span>`;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function renderNumstatNoteHtml(text) {
  return `<span class="diff-file-row-numstat-note">${escapeHtml(text)}</span>`;
}

/**
 * @param {string} fileName
 * @returns {number | null}
 */
export function estimateAddedLineCountFromChunk(fileName) {
  const chunk = diffChunks[fileName];
  if (!chunk) return null;
  let inHunk = false;
  let added = 0;
  for (const line of chunk.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
  }
  return added;
}

/**
 * @param {string | null} content
 * @returns {number}
 */
function countTextLines(content) {
  if (!content) return 0;
  const newlines = (content.match(/\n/g) || []).length;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * @param {string} fileName
 * @param {string} workspaceName
 * @returns {Promise<number | null>}
 */
async function estimateAddedLineCountFromFileContent(fileName, workspaceName) {
  try {
    const res = await apiFetch(workspaceApiPath(workspaceName, `/file-content?path=${encodeURIComponent(fileName)}`));
    if (!res) return null;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") return null;
    if (data.binary || data.too_large || data.image) return null;
    if (typeof data.content !== "string") return null;
    return countTextLines(data.content);
  } catch {
    return null;
  }
}

/**
 * @param {string} name
 * @param {string} status
 * @param {number} insertions
 * @param {number} deletions
 * @returns {string}
 */
function renderDiffFileStatHtml(name, status, insertions, deletions) {
  if (Number.isFinite(insertions) || Number.isFinite(deletions)) {
    return renderNumstatHtml(insertions, deletions);
  }
  if (DIFF_NEW_STATUSES.has(status || "")) {
    const added = estimateAddedLineCountFromChunk(name);
    if (Number.isFinite(added)) return renderNumstatNoteHtml(`+${added}`);
  }
  return "";
}

/**
 * @param {HTMLElement} fileList
 * @param {any[]} files
 * @param {string} workspaceName
 * @returns {Promise<void>}
 */
async function fillMissingAddedFileStats(fileList, files, workspaceName) {
  if (!workspaceName) return;
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const status = f.status || "";
    if (!DIFF_NEW_STATUSES.has(status)) continue;
    if (Number.isFinite(f.insertions) || Number.isFinite(f.deletions)) continue;
    const name = f.name;
    if (!name) continue;
    const fromChunk = estimateAddedLineCountFromChunk(name);
    if (Number.isFinite(fromChunk)) continue;

    const row = Array.from(fileList.querySelectorAll(".diff-file-row[data-file]"))
      .find((el) => el.dataset.file === name);
    if (!row || row.querySelector(".diff-file-row-numstat, .diff-file-row-numstat-note")) continue;

    const added = await estimateAddedLineCountFromFileContent(name, workspaceName);
    if (!Number.isFinite(added)) continue;
    if (selectedWorkspace !== workspaceName) return;
    row.insertAdjacentHTML("beforeend", renderNumstatNoteHtml(`+${added}`));
  }
}

/**
 * @param {HTMLElement} fileList
 * @param {any[]} files
 * @param {string} diffText
 * @param {{ statusBadgeLeft?: boolean }} [options]
 * @returns {void}
 */
function renderDiffFileList(fileList, files, diffText, options = {}) {
  const statusBadgeLeft = !!options.statusBadgeLeft;
  setDiffChunks(splitDiffByFile(diffText));
  setDiffFullText(diffText);
  fileList.innerHTML = "";

  let html = '<div class="file-browser diff-file-browser">';
  html += '<ul class="file-browser-list diff-file-browser-list">';
  if (files.length === 0) {
    html += '<li class="file-browser-item diff-file-row-empty"><span class="file-browser-item-name">変更ファイルなし</span></li>';
  } else {
    for (const f of files) {
      const isObj = typeof f === "object";
      const name = isObj ? f.name : f;
      const status = isObj && f.status ? f.status : "";
      const insertions = isObj ? f.insertions : null;
      const deletions = isObj ? f.deletions : null;
      const isNew = isObj && DIFF_NEW_STATUSES.has(f.status);
      const fi = getFileIcon(name);
      const colorStyle = fi.color ? ` style="color:${fi.color}"` : "";
      const iconHtml = `<i class="mdi ${fi.icon}"${colorStyle}></i>`;
      const rowClass = isNew ? "file-browser-item diff-file-row diff-file-row-new" : "file-browser-item diff-file-row";
      const statusHtml = status
        ? `<span class="file-browser-item-size diff-file-row-status${statusBadgeLeft ? " diff-file-row-status-left" : ""} diff-status-${getDiffStatusTone(status)}">${escapeHtml(status)}</span>`
        : "";
      html += `<li class="${rowClass}" data-file="${escapeHtml(name)}">` +
        (statusBadgeLeft ? statusHtml : "") +
        `<span class="file-browser-item-icon file-icon">${iconHtml}</span>` +
        `<span class="file-browser-item-name">${escapeHtml(name)}</span>` +
        renderDiffFileStatHtml(name, status, insertions, deletions) +
        (statusBadgeLeft ? "" : statusHtml) +
        "</li>";
    }
  }
  html += "</ul></div>";
  fileList.innerHTML = html;

  for (const row of fileList.querySelectorAll(".diff-file-row[data-file]")) {
    row.addEventListener("click", () => {
      const file = row.dataset.file || null;
      selectDiffFile(file);
    });
  }

  void fillMissingAddedFileStats(fileList, files, selectedWorkspace);
}

/**
 * @param {string | null} file
 * @returns {Promise<void>}
 */
async function selectDiffFile(file) {
  const fileList = $("diff-file-list");
  for (const row of fileList.querySelectorAll(".diff-file-row[data-file]")) {
    row.classList.toggle("active", !!file && row.dataset.file === file);
  }
  if (!file) {
    await loadDirectoryInDiffPane("");
    $("diff-content").scrollTop = 0;
    return;
  }
  const activeRow = fileList.querySelector(`.diff-file-row[data-file="${CSS.escape(file)}"]`);
  if (diffChunks[file] && !(activeRow && activeRow.classList.contains("diff-file-row-new"))) {
    showDiffFileInDiffPane(file);
  } else {
    await loadFileContentInDiffPane(file);
  }
  $("diff-content").scrollTop = 0;
}

/** @returns {Promise<void>} */
/** @returns {Array<{label: string, key?: string, fn: () => void}>} */
export function workingTreeActions() {
  return [
    { label: "コミット", fn: () => openCommitForm() },
    { label: "Stash一覧", key: "stash-list", fn: () => GitLogModal.openStashPane() },
  ];
}

export async function loadDiffTab() {
  if (!selectedWorkspace) return;
  clearActiveDiffRef();

  initDiffPane(workingTreeActions());

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/diff"));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showDiffError(data.detail || "diff の取得に失敗しました");
      return;
    }

    await showLoadedDiff($("diff-file-list"), data, { statusBadgeLeft: true, focusFileBrowser: true });
  } catch (e) {
    showDiffError(e.message);
  }
}


/** @returns {void} */
export function openCommitForm() {
  const form = $("diff-commit-form");
  const visible = form.style.display !== "none";
  if (visible) {
    closeCommitForm();
    return;
  }
  $("diff-commit-message").value = "";
  hideFormError("diff-commit-error");
  form.style.display = "block";
}

/** @returns {void} */
export function closeCommitForm() {
  $("diff-commit-form").style.display = "none";
  $("diff-commit-message").value = "";
  hideFormError("diff-commit-error");
}

/** @returns {Promise<void>} */
export async function submitCommit() {
  const message = $("diff-commit-message").value.trim();
  if (!message) {
    showFormError("diff-commit-error", "コミットメッセージを入力してください");
    return;
  }
  hideFormError("diff-commit-error");
  $("diff-commit-submit").disabled = true;
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/commit"), {
      method: "POST",
      body: { message },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showFormError("diff-commit-error", getActionFailureMessage(data, "コミットに失敗しました"));
      return;
    }
    GitLogModal.closeFileModal();
    showToast("コミット完了", "success");
    await refreshCurrentWorkspaceStatus();
  } catch (e) {
    showFormError("diff-commit-error", e.message);
  } finally {
    $("diff-commit-submit").disabled = false;
  }
}
