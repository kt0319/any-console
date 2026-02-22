async function gitFetch() {
  if (!selectedWorkspace) return;
  const fetchBtn = $("fetch-btn");
  fetchBtn.classList.add("running");
  try {
    await fetchWorkspace(selectedWorkspace);
    await loadWorkspaces();
    await updateHeaderInfo();
    if ($("git-log-modal").style.display !== "none") {
      await reloadGitLog();
    }
    showToast("fetch 完了", "success");
  } catch (e) {
    showToast(`fetch エラー: ${e.message}`);
  } finally {
    fetchBtn.classList.remove("running");
  }
}

async function gitPull() {
  if (!selectedWorkspace) return;
  if (!confirm(`${selectedWorkspace} を pull しますか？`)) return;

  const pullBtn = $("pull-btn");
  pullBtn.classList.add("running");

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/pull`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast("pull 完了", "success");
    } else {
      showToast(`pull 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`pull エラー: ${e.message}`);
  } finally {
    pullBtn.classList.remove("running");
    await loadWorkspaces();
    await updateHeaderInfo();
  }
}

async function gitPush() {
  if (!selectedWorkspace) return;
  if (!confirm(`${selectedWorkspace} を push しますか？`)) return;

  const pushBtn = $("push-btn");
  pushBtn.classList.add("running");

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast("push 完了", "success");
    } else {
      showToast(`push 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`push エラー: ${e.message}`);
  } finally {
    pushBtn.classList.remove("running");
    await loadWorkspaces();
    await updateHeaderInfo();
  }
}

async function loadBranches() {
  cachedBranches = [];
  if (!selectedWorkspace) return;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/branches`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    cachedBranches = await res.json();
  } catch {}
}

async function checkoutBranch(branch) {
  if (!selectedWorkspace || !branch) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  if (ws && ws.branch === branch) return;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ branch }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }

    const data = await res.json();
    const statusText = data.status || (res.ok ? "ok" : "error");

    if (statusText === "ok") {
      await loadWorkspaces();
      await updateHeaderInfo();
      renderJobMenu();
    } else {
      switchTab(null);
      let html = `<div class="output-status"><span class="status-badge error">${escapeHtml(statusText)}</span></div>`;
      if (!res.ok && data.detail) {
        html += `\n<span style="color:var(--error)">${escapeHtml(data.detail)}</span>`;
      }
      if (data.stdout) html += escapeHtml(data.stdout);
      if (data.stderr) {
        html += `\n<span style="color:var(--error)">${escapeHtml(data.stderr)}</span>`;
      }
      $("output").innerHTML = html;
    }
  } catch (e) {
    switchTab(null);
    $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`;
  }
}

function toggleCommitActionMenu(entry, hash, msg, branches = []) {
  const list = entry.closest(".git-log-list-modal");
  const menuEl = $("git-log-action-menu");
  const wasOpen = entry.classList.contains("action-open");

  if (list) {
    list.querySelectorAll(".git-log-commit").forEach((e) => e.classList.remove("action-open"));
  }

  if (wasOpen) {
    menuEl.style.display = "none";
    menuEl.innerHTML = "";
    resetCreateBranchArea();
    return;
  }

  entry.classList.add("action-open");
  menuEl.innerHTML = "";
  resetCreateBranchArea();

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const switchActions = branches
    .filter((b) => !ws || b !== ws.branch)
    .map((b) => ({
      label: `switch: ${b}`,
      cls: "",
      fn: async () => {
        if (!confirm(`${b} に切り替えますか？`)) return;
        await checkoutBranch(b);
        closeGitLogModal();
        await loadWorkspaces();
        await updateHeaderInfo();
      },
    }));

  const actions = [
    ...switchActions,
    { label: "diff", cls: "", fn: () => { $("git-log-modal").style.display = "none"; openCommitDiffModal(hash, msg); } },
    { label: "checkout -b", cls: "", fn: () => toggleCreateBranchArea(hash) },
    { label: "cherry-pick", cls: "", fn: () => execCommitAction("cherry-pick", hash) },
    { label: "revert", cls: "", fn: () => execCommitAction("revert", hash) },
    { label: "reset --soft", cls: "", fn: () => execCommitResetAction(hash, "soft") },
    { label: "reset --hard", cls: "commit-action-danger", fn: () => execCommitResetAction(hash, "hard") },
  ];

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "commit-action-item" + (action.cls ? ` ${action.cls}` : "");
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.fn();
    });
    menuEl.appendChild(btn);
  }

  menuEl.style.display = "flex";
}

async function execCommitAction(action, hash) {
  if (!selectedWorkspace) return;
  const shortHash = hash.substring(0, 8);
  if (!confirm(`${action} ${shortHash} を実行しますか？`)) return;
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commit_hash: hash }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${action} 完了`, "success");
    } else {
      showToast(`${action} 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`${action} エラー: ${e.message}`);
  }
  closeGitLogModal();
  await loadWorkspaces();
  await updateHeaderInfo();
}

async function execCommitResetAction(hash, mode) {
  if (!selectedWorkspace) return;
  const shortHash = hash.substring(0, 8);
  const warning = mode === "hard"
    ? `reset --hard ${shortHash} を実行します。作業ツリーの変更はすべて失われます。実行しますか？`
    : `reset --soft ${shortHash} を実行しますか？`;
  if (!confirm(warning)) return;
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/reset`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commit_hash: hash, mode }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`reset --${mode} 完了`, "success");
    } else {
      showToast(`reset 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`reset エラー: ${e.message}`);
  }
  closeGitLogModal();
  await loadWorkspaces();
  await updateHeaderInfo();
}

function closeGitLogModal() {
  $("git-log-modal").style.display = "none";
  $("git-log-action-menu").style.display = "none";
  $("git-log-action-menu").innerHTML = "";
  resetCreateBranchArea();
}

function resetCreateBranchArea() {
  $("git-log-create-branch-area").style.display = "none";
  $("git-log-create-branch-submit").style.display = "none";
  $("git-log-branch-name").value = "";
  $("git-log-branch-error").style.display = "none";
}

function toggleCreateBranchArea(hash) {
  const area = $("git-log-create-branch-area");
  const visible = area.style.display !== "none";
  if (visible) {
    resetCreateBranchArea();
  } else {
    createBranchFromHash = hash || null;
    area.style.display = "block";
    $("git-log-branch-name").focus();
  }
}

async function submitCreateBranch() {
  if (!selectedWorkspace) return;
  const branchName = $("git-log-branch-name").value.trim();
  const errorEl = $("git-log-branch-error");

  if (!branchName) {
    errorEl.textContent = "ブランチ名を入力してください";
    errorEl.style.display = "block";
    return;
  }
  if (!/^[a-zA-Z0-9_./-]+$/.test(branchName)) {
    errorEl.textContent = "ブランチ名に使えない文字が含まれています";
    errorEl.style.display = "block";
    return;
  }

  errorEl.style.display = "none";
  $("git-log-create-branch-submit").disabled = true;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/create-branch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ branch: branchName }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      errorEl.textContent = data.detail || data.stderr || "ブランチ作成に失敗しました";
      errorEl.style.display = "block";
      return;
    }
    closeGitLogModal();
    await loadWorkspaces();
    await updateHeaderInfo();
    renderJobMenu();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  } finally {
    $("git-log-create-branch-submit").disabled = false;
  }
}

function renderGitLogEntries(listEl, stdout) {
  const lines = stdout.split("\n");
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;

    const entry = document.createElement("div");
    const commitMatch = line.match(/^(.*?)([0-9a-f]{40})\t(.+?)\t(.+?)\t(.*?)\t(.*)$/);
    if (commitMatch) {
      const graph = commitMatch[1].replace(/\*/g, " ");
      const hash = commitMatch[2];
      if (gitLogSeenHashes.has(hash)) continue;
      gitLogSeenHashes.add(hash);
      const time = commitMatch[3];
      const author = commitMatch[4];
      const refs = commitMatch[5];
      const msg = commitMatch[6];
      entry.className = "git-log-entry git-log-commit";
      let refsHtml = "";
      if (refs) {
        refsHtml = refs.split(",").map((r) => {
          const name = r.trim();
          if (!name || name === "origin/HEAD" || name === "HEAD") return "";
          const isTag = name.startsWith("tag: ");
          const isHead = name.startsWith("HEAD -> ");
          const remoteMatch = name.match(/^(origin|upstream)\/(.*)/);
          const isRemote = remoteMatch && !isTag && !isHead;
          const cls = isTag ? "git-ref-tag" : isHead ? "git-ref-head" : isRemote ? "git-ref-remote" : "git-ref-branch";
          let label;
          if (isRemote) {
            const icon = remoteMatch[1] === "origin" ? "mdi-github" : "mdi-server";
            label = `<span class="mdi ${icon}"></span> ${escapeHtml(remoteMatch[2])}`;
          } else if (isTag) {
            label = `<span class="mdi mdi-tag-outline"></span> ${escapeHtml(name.replace("tag: ", ""))}`;
          } else if (isHead) {
            const branchName = name.replace("HEAD -> ", "");
            label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(branchName)}`;
          } else {
            label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(name)}`;
          }
          return `<span class="git-ref ${cls}">${label}</span>`;
        }).join("");
      }
      entry.innerHTML =
        `<span class="git-log-entry-body">` +
          (refsHtml ? `<span class="git-log-entry-refs">${refsHtml}</span>` : "") +
          `<span class="git-log-entry-row1"><span class="git-log-entry-msg">${escapeHtml(msg)}</span></span>` +
          `<span class="git-log-entry-meta"><span class="git-log-entry-time">${escapeHtml(time)}</span><span class="git-log-entry-author">${escapeHtml(author)}</span></span>` +
        `</span>`;
      const branchSet = new Set();
      if (refs) {
        for (const r of refs.split(",")) {
          const name = r.trim();
          if (!name || name === "origin/HEAD" || name === "HEAD") continue;
          if (name.startsWith("HEAD -> ")) {
            branchSet.add(name.replace("HEAD -> ", ""));
          } else if (name.startsWith("tag: ")) {
            continue;
          } else {
            const rm = name.match(/^(?:origin|upstream)\/(.*)/);
            branchSet.add(rm ? rm[1] : name);
          }
        }
      }
      const branches = [...branchSet];
      entry.addEventListener("click", () => {
        $("git-log-modal").style.display = "none";
        diffOpenedFromGitLog = true;
        openCommitDiffModal(hash, msg, branches);
      });
      count++;
    } else {
      continue;
    }
    listEl.appendChild(entry);
  }
  return count;
}

async function loadMoreGitLog() {
  if (!selectedWorkspace || gitLogLoading || !gitLogHasMore) return;
  gitLogLoading = true;

  const listEl = $("git-log-list-modal");
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/git-log?limit=${GIT_LOG_PAGE_SIZE}&skip=${gitLogLoaded}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok" || !data.stdout) {
      gitLogHasMore = false;
      return;
    }
    const count = renderGitLogEntries(listEl, data.stdout);
    gitLogLoaded += count;
    if (count < GIT_LOG_PAGE_SIZE) {
      gitLogHasMore = false;
    }
  } catch (e) {
    gitLogHasMore = false;
  } finally {
    gitLogLoading = false;
  }
}

async function reloadGitLog() {
  if (!selectedWorkspace) return;

  const listEl = $("git-log-list-modal");
  listEl.innerHTML = '<div class="git-log-entry-msg" style="color:var(--text-muted);padding:16px">読み込み中...</div>';

  gitLogLoaded = 0;
  gitLogLoading = false;
  gitLogHasMore = true;
  gitLogSeenHashes.clear();

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/git-log?limit=${GIT_LOG_PAGE_SIZE}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      listEl.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(data.detail || data.stderr || "failed to load git log")}</div>`;
      return;
    }
    if (!data.stdout) {
      listEl.innerHTML = '<div style="color:var(--text-muted);padding:16px">ログがありません</div>';
      return;
    }

    listEl.innerHTML = "";
    const count = renderGitLogEntries(listEl, data.stdout);
    gitLogLoaded = count;
    if (count < GIT_LOG_PAGE_SIZE) {
      gitLogHasMore = false;
    }
  } catch (e) {
    listEl.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

async function openGitLogModal() {
  if (!selectedWorkspace) return;
  $("git-log-modal").style.display = "flex";
  await reloadGitLog();
}

function renderDiffActions(container, hash, branches) {
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const switchActions = branches
    .filter((b) => !ws || b !== ws.branch)
    .map((b) => ({
      label: `switch: ${b}`,
      cls: "",
      fn: async () => {
        if (!confirm(`${b} に切り替えますか？`)) return;
        $("diff-modal").style.display = "none";
        await checkoutBranch(b);
        closeGitLogModal();
        await loadWorkspaces();
        await updateHeaderInfo();
      },
    }));

  const actions = [
    ...switchActions,
    { label: "checkout -b", cls: "", fn: () => { $("diff-modal").style.display = "none"; $("git-log-modal").style.display = "flex"; toggleCreateBranchArea(hash); } },
    { label: "cherry-pick", cls: "", fn: () => { $("diff-modal").style.display = "none"; execCommitAction("cherry-pick", hash); } },
    { label: "revert", cls: "", fn: () => { $("diff-modal").style.display = "none"; execCommitAction("revert", hash); } },
    { label: "reset --soft", cls: "", fn: () => { $("diff-modal").style.display = "none"; execCommitResetAction(hash, "soft"); } },
    { label: "reset --hard", cls: "commit-action-danger", fn: () => { $("diff-modal").style.display = "none"; execCommitResetAction(hash, "hard"); } },
  ];

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "commit-action-item" + (action.cls ? ` ${action.cls}` : "");
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.fn();
    });
    container.appendChild(btn);
  }
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
  $("diff-modal").querySelector("h3").textContent = commitMsg || "変更内容";
  $("diff-modal").style.display = "flex";

  if (commitHash) {
    renderDiffActions(actionsEl, commitHash, branches);
  }

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/diff/${encodeURIComponent(commitHash)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
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

function selectDiffFile(file) {
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
  } else {
    diffContent.textContent = file ? "このファイルのdiffはありません" : "差分なし";
  }
  diffContent.scrollTop = 0;
}

async function execStashAction(action) {
  if (!selectedWorkspace) return;
  const endpoint = action === "pop" ? "stash-pop" : "stash";
  const label = action === "pop" ? "stash pop" : "stash";
  if (!confirm(`${label} を実行しますか？`)) return;
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${label} 完了`, "success");
    } else {
      showToast(`${label} 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`${label} エラー: ${e.message}`);
  }
  $("diff-modal").style.display = "none";
  await loadWorkspaces();
  await updateHeaderInfo();
}

async function openDiffModal() {
  if (!selectedWorkspace) return;
  $("diff-modal").querySelector("h3").textContent = "変更内容";

  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  const actionsEl = $("diff-actions");
  fileList.innerHTML = '<span class="diff-file-tag">loading...</span>';
  diffContent.textContent = "";
  actionsEl.innerHTML = "";

  const stashActions = [
    { label: "stash", cls: "", fn: () => execStashAction("save") },
    { label: "stash pop", cls: "", fn: () => execStashAction("pop") },
  ];
  for (const action of stashActions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "commit-action-item" + (action.cls ? ` ${action.cls}` : "");
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.fn();
    });
    actionsEl.appendChild(btn);
  }
  actionsEl.style.display = "flex";

  $("diff-modal").style.display = "flex";

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/diff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
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

function closeDiffModal() {
  $("diff-modal").style.display = "none";
  if (diffOpenedFromGitLog) {
    diffOpenedFromGitLog = false;
    $("git-log-modal").style.display = "flex";
  }
}

async function openBranchModal() {
  const listEl = $("branch-list");
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
  $("branch-modal").style.display = "flex";

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/branches/remote`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) {
      listEl.innerHTML = '<div class="clone-repo-error">取得に失敗しました</div>';
      return;
    }
    const remoteBranches = await res.json();
    if (remoteBranches.length === 0) {
      listEl.innerHTML = '<div class="clone-repo-empty">リモートブランチがありません</div>';
      return;
    }

    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    const currentBranch = ws ? ws.branch : null;

    listEl.innerHTML = "";
    for (const branch of remoteBranches) {
      const item = document.createElement("div");
      item.className = "branch-item";
      if (branch === currentBranch) {
        item.classList.add("current");
        item.textContent = `${branch} ✓`;
      } else if (cachedBranches.includes(branch)) {
        item.classList.add("local-exists");
        item.textContent = branch;
      } else {
        item.textContent = branch;
      }
      item.addEventListener("click", () => {
        if (branch === currentBranch) return;
        $("branch-modal").style.display = "none";
        checkoutBranch(branch);
      });
      listEl.appendChild(item);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="clone-repo-error">${escapeHtml(e.message)}</div>`;
  }
}

function closeBranchModal() {
  $("branch-modal").style.display = "none";
}
