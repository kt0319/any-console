function renderDiffActions(container, hash, branches) {
  const actions = GitCore.buildCommitActions(hash, {
    branches,
    checkoutBranchFn: () => {
      GitLogModal.closeDiffPane();
      GitLogModal.toggleCreateBranchArea(hash);
    },
  });

  renderActionButtons(container, actions);
  container.style.display = "flex";
}

function initDiffPane(actions = null) {
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  const actionsEl = $("diff-actions");
  fileList.innerHTML = '<div class="file-browser"><div class="file-browser-header"><span class="file-browser-crumb-current">読み込み中...</span></div></div>';
  diffContent.textContent = "ファイルを選択してください";
  actionsEl.innerHTML = "";
  actionsEl.style.display = "none";
  $("diff-commit-form").style.display = "none";

  if (Array.isArray(actions) && actions.length > 0) {
    renderActionButtons(actionsEl, actions);
    actionsEl.style.display = "flex";
  }
}

function showDiffError(message) {
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  fileList.innerHTML = "";
  diffContent.textContent = message || "diff の取得に失敗しました";
}

async function openCommitDiffModal(commitHash, commitMsg, branches = []) {
  const actionsEl = $("diff-actions");
  initDiffPane();
  GitLogModal.state.previousModalTab = "commits";
  GitLogModal.showDiffPane(commitMsg || "");

  if (commitHash) {
    if (commitHash.startsWith("stash@")) {
      const actions = [
        { label: "stash pop", cls: "", fn: () => GitLogModal.execStashRefAction("pop", commitHash) },
        { label: "stash drop", cls: "commit-action-danger", fn: () => GitLogModal.execStashRefAction("drop", commitHash) },
      ];
      renderActionButtons(actionsEl, actions);
      actionsEl.style.display = "flex";
    } else {
      renderDiffActions(actionsEl, commitHash, branches);
    }
  }

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/diff/${encodeURIComponent(commitHash)}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showDiffError(data.detail || data.stderr || "diff の取得に失敗しました");
      return;
    }

    const fileList = $("diff-file-list");
    const diffContent = $("diff-content");
    renderDiffFileList(fileList, data.files, data.diff || "");
    diffContent.textContent = "ファイルを選択してください";
  } catch (e) {
    showDiffError(e.message);
  }
}

function colorDiff(text) {
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

function splitDiffByFile(diffText) {
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

const DIFF_NEW_STATUSES = new Set(["??", "A"]);

function getDiffStatusTone(status) {
  const s = (status || "").toUpperCase();
  if (s === "??" || s === "A") return "add";
  if (s.includes("D")) return "del";
  if (s.includes("R")) return "ren";
  if (s.includes("M")) return "mod";
  return "neutral";
}

function renderNumstatHtml(insertions, deletions, extraClass = "") {
  const hasIns = Number.isFinite(insertions);
  const hasDel = Number.isFinite(deletions);
  if (!hasIns && !hasDel) return "";
  const ins = hasIns ? insertions : 0;
  const del = hasDel ? deletions : 0;
  const cls = extraClass ? `diff-file-row-numstat ${extraClass}` : "diff-file-row-numstat";
  return `<span class="${cls}"><span class="diff-num-plus">+${ins}</span><span class="diff-num-del">-${del}</span></span>`;
}

function renderNumstatNoteHtml(text) {
  return `<span class="diff-file-row-numstat-note">${escapeHtml(text)}</span>`;
}

function estimateAddedLineCountFromChunk(fileName) {
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

function countTextLines(content) {
  if (!content) return 0;
  const newlines = (content.match(/\n/g) || []).length;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

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

function renderDiffFileList(fileList, files, diffText, options = {}) {
  const statusBadgeLeft = !!options.statusBadgeLeft;
  diffChunks = splitDiffByFile(diffText);
  diffFullText = diffText;
  fileList.innerHTML = "";

  let html = '<div class="file-browser diff-file-browser">';
  html += '<ul class="file-browser-list diff-file-browser-list">';
  if (files.length === 0) {
    html += '<li class="file-browser-item diff-file-row-empty"><span class="file-browser-item-name">変更ファイルなし</span></li>';
  } else {
    let totalInsertions = 0;
    let totalDeletions = 0;
    let hasTotalNumstat = false;
    for (const f of files) {
      if (typeof f !== "object") continue;
      if (Number.isFinite(f.insertions)) {
        totalInsertions += f.insertions;
        hasTotalNumstat = true;
      }
      if (Number.isFinite(f.deletions)) {
        totalDeletions += f.deletions;
        hasTotalNumstat = true;
      }
    }
    html += '<li class="file-browser-item diff-file-row active" data-file="">' +
      '<span class="file-browser-item-icon file-icon"><i class="mdi mdi-file-multiple-outline"></i></span>' +
      '<span class="file-browser-item-name">すべて</span>' +
      (hasTotalNumstat ? renderNumstatHtml(totalInsertions, totalDeletions) : "") +
      '</li>';
    for (const f of files) {
      const isObj = typeof f === "object";
      const name = isObj ? f.name : f;
      const status = isObj && f.status ? f.status : "";
      const insertions = isObj ? f.insertions : null;
      const deletions = isObj ? f.deletions : null;
      const isNew = isObj && DIFF_NEW_STATUSES.has(f.status);
      let iconHtml = '<i class="mdi mdi-file-outline"></i>';
      if (typeof getFileIcon === "function") {
        const fi = getFileIcon(name);
        if (fi && fi.icon) {
          const colorStyle = fi.color ? ` style="color:${fi.color}"` : "";
          iconHtml = `<i class="mdi ${fi.icon}"${colorStyle}></i>`;
        }
      }
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

async function selectDiffFile(file) {
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  for (const row of fileList.querySelectorAll(".diff-file-row[data-file]")) {
    if (file === null) {
      row.classList.toggle("active", !row.dataset.file);
    } else {
      row.classList.toggle("active", row.dataset.file === file);
    }
  }
  diffContent.textContent = "";
  const text = file ? (diffChunks[file] || "") : diffFullText;
  if (text) {
    diffContent.appendChild(colorDiff(text));
  } else if (file) {
    await loadFileContentInto(file, diffContent);
  } else {
    diffContent.textContent = "差分なし";
  }
  diffContent.scrollTop = 0;
  GitLogModal.state.previousModalTab = "diff";
  const title = file ? file.split("/").pop() : "差分（すべて）";
  GitLogModal.showSubPane("commit-modal-tab-diff-view", title);
}

async function loadFileContentInto(filePath, container) {
  container.textContent = "読み込み中...";
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/file-content?path=${encodeURIComponent(filePath)}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      container.textContent = data.detail || "ファイルの読み込みに失敗しました";
      return;
    }
    if (data.binary) {
      container.textContent = `バイナリファイル (${data.size} bytes)`;
      return;
    }
    if (data.too_large) {
      container.textContent = `ファイルが大きすぎます (${data.size} bytes)`;
      return;
    }
    renderHighlightedFileContent(container, filePath, data.content);
  } catch (e) {
    container.textContent = e.message;
  }
}

function renderHighlightedFileContent(container, filePath, content) {
  if (typeof renderHighlightedTextHtml !== "function") {
    container.textContent = content;
    return;
  }
  const codeHtml = renderHighlightedTextHtml(content, filePath);
  container.innerHTML = `<code class="text-viewer-box-content viewer-content hljs">${codeHtml}</code>`;
}

async function loadDiffTab() {
  if (!selectedWorkspace) return;

  const stashActions = [
    { label: "コミット", cls: "", fn: () => openCommitForm() },
    { label: "stash", cls: "", fn: () => GitCore.execStashAction("save") },
    { label: "stash pop", cls: "", fn: () => GitCore.execStashAction("pop") },
  ];
  initDiffPane(stashActions);

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/diff"));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showDiffError(data.detail || "diff の取得に失敗しました");
      return;
    }

    const fileList = $("diff-file-list");
    const diffContent = $("diff-content");
    renderDiffFileList(fileList, data.files, data.diff || "", { statusBadgeLeft: true });
    diffContent.textContent = "ファイルを選択してください";
  } catch (e) {
    showDiffError(e.message);
  }
}

async function openDiffModal() {
  if (!selectedWorkspace) return;

  GitLogModal.state.isGitLogFilesLoaded = false;
  GitLogModal.state.previousModalTab = "commits";
  $("git-log-modal").style.display = "flex";
  GitLogModal.updateGitLogBranchLabel();
  GitLogModal.showDiffPane("未コミットの変更");
  await loadDiffTab();
}

function openCommitForm() {
  $("diff-actions").style.display = "none";
  $("diff-commit-message").value = "";
  hideFormError("diff-commit-error");
  $("diff-commit-form").style.display = "block";
  $("diff-commit-message").focus();
}

function closeCommitForm() {
  $("diff-commit-form").style.display = "none";
  $("diff-actions").style.display = "flex";
}

async function submitCommit() {
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
      showFormError("diff-commit-error", data.detail || data.stderr || "コミットに失敗しました");
      return;
    }
    GitLogModal.closeGitLogModal();
    showToast("コミット完了", "success");
    await refreshWorkspaceHeader();
  } catch (e) {
    showFormError("diff-commit-error", e.message);
  } finally {
    $("diff-commit-submit").disabled = false;
  }
}
