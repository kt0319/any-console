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
  fileList.innerHTML = '<span class="diff-file-tag">loading...</span>';
  diffContent.textContent = "";
  actionsEl.innerHTML = "";
  actionsEl.style.display = "none";
  $("diff-commit-form").style.display = "none";
  previousModalTab = "commits";
  showDiffPane(commitMsg || "");

  if (commitHash) {
    renderDiffActions(actionsEl, commitHash, branches);
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
    diffContent.textContent = "";
    if (data.diff) {
      diffContent.appendChild(colorDiff(data.diff));
    } else {
      diffContent.textContent = "差分なし";
    }
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

function renderDiffFileList(fileList, files, diffText) {
  diffChunks = splitDiffByFile(diffText);
  diffFullText = diffText;
  fileList.innerHTML = "";

  if (files.length === 0) {
    fileList.innerHTML = '<span class="diff-file-tag">変更ファイルなし</span>';
    return;
  }

  const allTag = document.createElement("span");
  allTag.className = "diff-file-tag active";
  allTag.textContent = "すべて";
  allTag.addEventListener("click", () => selectDiffFile(null));
  fileList.appendChild(allTag);

  for (const f of files) {
    const tag = document.createElement("span");
    tag.className = "diff-file-tag";
    tag.dataset.file = f;
    tag.textContent = f;
    tag.addEventListener("click", () => selectDiffFile(f));
    fileList.appendChild(tag);
  }
}

async function selectDiffFile(file) {
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  for (const tag of fileList.querySelectorAll(".diff-file-tag")) {
    if (file === null) {
      tag.classList.toggle("active", !tag.dataset.file);
    } else {
      tag.classList.toggle("active", tag.dataset.file === file);
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
    container.textContent = data.content;
  } catch (e) {
    container.textContent = e.message;
  }
}

async function loadDiffTab() {
  if (!selectedWorkspace) return;
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  const actionsEl = $("diff-actions");
  fileList.innerHTML = '<span class="diff-file-tag">loading...</span>';
  diffContent.textContent = "";
  actionsEl.innerHTML = "";

  const stashActions = [
    { label: "コミット", cls: "", fn: () => openCommitForm() },
    { label: "stash", cls: "", fn: () => { if (confirm("stash を実行しますか？")) execStashAction("save"); } },
    { label: "stash pop", cls: "", fn: () => { if (confirm("stash pop を実行しますか？")) execStashAction("pop"); } },
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
    diffContent.textContent = "";
    if (data.diff) {
      diffContent.appendChild(colorDiff(data.diff));
    } else {
      diffContent.textContent = "差分なし（untracked files のみの可能性）";
    }
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
