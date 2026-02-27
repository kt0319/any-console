function renderDiffActions(container, hash, branches) {
  const actions = buildCommitActions(hash, {
    branches,
    checkoutBranchFn: () => { closeDiffPane(); toggleCreateBranchArea(hash); },
  });

  renderActionButtons(container, actions);
  container.style.display = "flex";
}

async function openCommitDiffModal(commitHash, commitMsg, branches = []) {
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  const actionsEl = $("diff-actions");
  fileList.innerHTML = '<div class="file-browser"><div class="file-browser-header"><span class="file-browser-crumb-current">読み込み中...</span></div></div>';
  diffContent.textContent = "ファイルを選択してください";
  actionsEl.innerHTML = "";
  actionsEl.style.display = "none";
  $("diff-commit-form").style.display = "none";
  previousModalTab = "commits";
  showDiffPane(commitMsg || "");

  if (commitHash) {
    if (commitHash.startsWith("stash@")) {
      const actions = [
        { label: "stash pop", cls: "", fn: () => execStashRefAction("pop", commitHash) },
        { label: "stash drop", cls: "commit-action-danger", fn: () => execStashRefAction("drop", commitHash) },
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
      fileList.innerHTML = "";
      diffContent.textContent = data.detail || data.stderr || "diff の取得に失敗しました";
      return;
    }

    renderDiffFileList(fileList, data.files, data.diff || "");
    diffContent.textContent = "ファイルを選択してください";
  } catch (e) {
    fileList.innerHTML = "";
    diffContent.textContent = e.message;
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

function renderNumstatHtml(insertions, deletions) {
  const hasIns = Number.isFinite(insertions);
  const hasDel = Number.isFinite(deletions);
  if (!hasIns && !hasDel) return "";
  const ins = hasIns ? insertions : 0;
  const del = hasDel ? deletions : 0;
  return `<span class="diff-file-row-numstat"><span class="diff-num-plus">+${ins}</span><span class="diff-num-del">-${del}</span></span>`;
}

function renderDiffFileList(fileList, files, diffText) {
  diffChunks = splitDiffByFile(diffText);
  diffFullText = diffText;
  fileList.innerHTML = "";

  let html = '<div class="file-browser diff-file-browser">';
  html += '<div class="file-browser-header"><span class="file-browser-crumb-current">ファイル</span></div>';
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
      html += `<li class="${rowClass}" data-file="${escapeHtml(name)}">` +
        `<span class="file-browser-item-icon file-icon">${iconHtml}</span>` +
        `<span class="file-browser-item-name">${escapeHtml(name)}</span>` +
        renderNumstatHtml(insertions, deletions) +
        (status ? `<span class="file-browser-item-size diff-file-row-status diff-status-${getDiffStatusTone(status)}">${escapeHtml(status)}</span>` : "") +
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
  previousModalTab = "diff";
  const title = file ? file.split("/").pop() : "差分（すべて）";
  showSubPane("commit-modal-tab-diff-view", title);
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

function getHighlightKeyFromPath(path) {
  const name = (path || "").split("/").pop().toLowerCase();
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx + 1) : name;
}

function renderHighlightedFileContent(container, filePath, content) {
  if (typeof hljs === "undefined") {
    container.textContent = content;
    return;
  }

  const highlightKey = getHighlightKeyFromPath(filePath);
  const lang = typeof getHighlightLang === "function" ? getHighlightLang(highlightKey) : null;
  let codeHtml = "";
  try {
    codeHtml = lang
      ? hljs.highlight(content, { language: lang }).value
      : hljs.highlightAuto(content).value;
  } catch {
    if (typeof escapeHtml === "function") {
      codeHtml = escapeHtml(content);
    } else {
      container.textContent = content;
      return;
    }
  }

  container.innerHTML = `<code class="hljs">${codeHtml}</code>`;
}

async function loadDiffTab() {
  if (!selectedWorkspace) return;
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  const actionsEl = $("diff-actions");
  fileList.innerHTML = '<div class="file-browser"><div class="file-browser-header"><span class="file-browser-crumb-current">読み込み中...</span></div></div>';
  diffContent.textContent = "ファイルを選択してください";
  actionsEl.innerHTML = "";

  const stashActions = [
    { label: "コミット", cls: "", fn: () => openCommitForm() },
    { label: "stash", cls: "", fn: () => execStashAction("save") },
    { label: "stash pop", cls: "", fn: () => execStashAction("pop") },
  ];
  renderActionButtons(actionsEl, stashActions);
  actionsEl.style.display = "flex";
  $("diff-commit-form").style.display = "none";

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/diff"));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      fileList.innerHTML = "";
      diffContent.textContent = data.detail || "diff の取得に失敗しました";
      return;
    }

    renderDiffFileList(fileList, data.files, data.diff || "");
    diffContent.textContent = "ファイルを選択してください";
  } catch (e) {
    fileList.innerHTML = "";
    diffContent.textContent = e.message;
  }
}

async function openDiffModal() {
  if (!selectedWorkspace) return;

  isGitLogFilesLoaded = false;
  previousModalTab = "commits";
  $("git-log-modal").style.display = "flex";
  updateGitLogBranchLabel();
  showDiffPane("未コミットの変更");
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
    closeGitLogModal();
    showToast("コミット完了", "success");
    await refreshWorkspaceHeader();
  } catch (e) {
    showFormError("diff-commit-error", e.message);
  } finally {
    $("diff-commit-submit").disabled = false;
  }
}
