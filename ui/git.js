async function refreshAfterGitOp() {
  await loadWorkspaces();
  await refreshWorkspaceHeader();
}

async function gitFetch() {
  if (!selectedWorkspace) return;
  const fetchBtn = $("fetch-btn");
  if (fetchBtn.disabled) return;
  fetchBtn.disabled = true;
  fetchBtn.classList.add("running");
  try {
    await gitFetchWorkspace(selectedWorkspace);
    await refreshAfterGitOp();
    if ($("git-log-modal").style.display !== "none") {
      await reloadGitLog();
    }
    showToast("fetch 完了", "success");
  } catch (e) {
    showToast(`fetch エラー: ${e.message}`);
  } finally {
    fetchBtn.classList.remove("running");
    fetchBtn.disabled = false;
  }
}

async function executeGitRemoteOp(buttonId, endpoint, label) {
  if (!selectedWorkspace) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const branch = ws && ws.branch ? ws.branch : "(不明)";
  const actionLabel = label === "追跡設定" ? "追跡設定" : label;
  const msg = `${actionLabel} を実行しますか？\nリポジトリ: ${selectedWorkspace}\nブランチ: ${branch}`;
  if (!confirm(msg)) return;

  const btn = $(buttonId);
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("running");

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, endpoint), { method: "POST" });
    if (!res) return;
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${label} 完了`, "success");
    } else {
      showToast(`${label} 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`${label} エラー: ${e.message}`);
  } finally {
    btn.classList.remove("running");
    btn.disabled = false;
    await refreshAfterGitOp();
  }
}

async function gitPull() {
  await executeGitRemoteOp("pull-btn", "/pull", "pull");
}

async function gitSetUpstream() {
  await executeGitRemoteOp("set-upstream-btn", "/set-upstream", "追跡設定");
}

async function gitPushUpstream() {
  await executeGitRemoteOp("push-upstream-btn", "/push-upstream", "push");
}

async function gitPush() {
  await executeGitRemoteOp("push-btn", "/push", "push");
}

async function loadBranches() {
  cachedBranches = [];
  if (!selectedWorkspace) return;

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/branches"));
    if (!res || !res.ok) return;
    cachedBranches = await res.json();
  } catch (e) { console.warn("loadBranches failed:", e); }
}

async function checkoutBranch(branch) {
  if (!selectedWorkspace || !branch) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  if (ws && ws.branch === branch) return;

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/checkout"), {
      method: "POST",
      body: { branch },
    });
    if (!res) return;

    const data = await res.json();
    const statusText = data.status || (res.ok ? "ok" : "error");

    if (statusText === "ok") {
      await refreshAfterGitOp();
    } else {
      const msg = data.detail || data.stderr || data.stdout || "checkout に失敗しました";
      showToast(msg);
    }
  } catch (e) {
    showToast(`checkout エラー: ${e.message}`);
  }
}

function buildBranchSwitchActions(branches, beforeSwitch) {
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  return branches
    .filter((b) => !ws || b !== ws.branch)
    .map((b) => ({
      label: `switch: ${b}`,
      cls: "",
      fn: async () => {
        if (!confirm(`${b} に切り替えますか？`)) return;
        if (beforeSwitch) beforeSwitch();
        await checkoutBranch(b);
        closeGitLogModal();
        await refreshAfterGitOp();
      },
    }));
}

function buildCommitActions(hash, { branches = [], checkoutBranchFn, extraActions = [] } = {}) {
  const switchActions = buildBranchSwitchActions(branches);
  return [
    ...switchActions,
    ...extraActions,
    { label: "checkout -b", cls: "", fn: checkoutBranchFn || (() => toggleCreateBranchArea(hash)) },
    { label: "cherry-pick", cls: "", fn: () => execCommitAction("cherry-pick", hash) },
    { label: "revert", cls: "", fn: () => execCommitAction("revert", hash) },
    { label: "reset --soft", cls: "", fn: () => execCommitResetAction(hash, "soft") },
    { label: "reset --hard", cls: "commit-action-danger", fn: () => execCommitResetAction(hash, "hard") },
  ];
}

function toggleCommitActionMenu(entry, hash, msg, branches = []) {
  const list = $("git-log-list-modal");
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

  const actions = buildCommitActions(hash, {
    branches,
    extraActions: [{ label: "diff", cls: "", fn: () => openCommitDiffModal(hash, msg) }],
  });

  renderActionButtons(menuEl, actions);
  menuEl.style.display = "flex";
}

async function execCommitAction(action, hash, body = null, confirmMsg = null) {
  if (!selectedWorkspace) return;
  const shortHash = hash.substring(0, 8);
  const msg = confirmMsg || `${action} ${shortHash} を実行しますか？`;
  if (!confirm(msg)) return;
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/${action}`), {
      method: "POST",
      body: body || { commit_hash: hash },
    });
    if (!res) return;
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
  await refreshAfterGitOp();
}

function execCommitResetAction(hash, mode) {
  const shortHash = hash.substring(0, 8);
  const confirmMsg = mode === "hard"
    ? `reset --hard ${shortHash} を実行します。作業ツリーの変更はすべて失われます。実行しますか？`
    : `reset --soft ${shortHash} を実行しますか？`;
  return execCommitAction(`reset`, hash, { commit_hash: hash, mode }, confirmMsg);
}

function closeGitLogModal() {
  $("git-log-modal").style.display = "none";
  $("git-log-action-menu").style.display = "none";
  $("git-log-action-menu").innerHTML = "";
  $("diff-commit-form").style.display = "none";
  const titleEl = $("git-log-modal-title");
  titleEl.classList.remove("split-modal-title-back");
  titleEl.onclick = null;

  resetCreateBranchArea();
}

function resetCreateBranchArea() {
  $("git-log-create-branch-area").style.display = "none";
  $("git-log-create-branch-submit").style.display = "none";
  $("git-log-branch-name").value = "";
  hideFormError("git-log-branch-error");
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

  if (!branchName) {
    showFormError("git-log-branch-error", "ブランチ名を入力してください");
    return;
  }
  if (!/^[a-zA-Z0-9_./-]+$/.test(branchName)) {
    showFormError("git-log-branch-error", "ブランチ名に使えない文字が含まれています");
    return;
  }

  hideFormError("git-log-branch-error");
  $("git-log-create-branch-submit").disabled = true;

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/create-branch"), {
      method: "POST",
      body: { branch: branchName },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      showFormError("git-log-branch-error", data.detail || data.stderr || "ブランチ作成に失敗しました");
      return;
    }
    closeGitLogModal();
    await refreshAfterGitOp();
  } catch (e) {
    showFormError("git-log-branch-error", e.message);
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
      const [, graph, hash, time, author, refs, msg] = commitMatch;
      const trimmedGraph = graph.replace(/\*/g, " ");
      if (gitLogSeenHashes.has(hash)) continue;
      gitLogSeenHashes.add(hash);
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
  if (!selectedWorkspace || isGitLogLoading || !gitLogHasMore) return;
  isGitLogLoading = true;

  const listEl = $("git-log-list-modal");
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_ENTRIES_PER_PAGE}&skip=${gitLogLoaded}`));
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status !== "ok" || !data.stdout) {
      gitLogHasMore = false;
      return;
    }
    const count = renderGitLogEntries(listEl, data.stdout);
    gitLogLoaded += count;
    if (count < GIT_LOG_ENTRIES_PER_PAGE) {
      gitLogHasMore = false;
    }
  } catch (e) {
    gitLogHasMore = false;
  } finally {
    isGitLogLoading = false;
  }
}

function updateGitLogBranchLabel() {
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  $("git-log-branch-label").textContent = ws ? ws.branch : "";
  updateStashBtn();
}

async function updateStashBtn() {
  const btn = $("stash-btn");
  if (!btn) return;
  if (!selectedWorkspace) { btn.textContent = "stash"; return; }
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
    if (!res || !res.ok) { btn.textContent = "stash"; return; }
    const data = await res.json();
    const count = (data.status === "ok" && data.entries) ? data.entries.length : 0;
    btn.textContent = count > 0 ? `stash (${count})` : "stash";
  } catch {
    btn.textContent = "stash";
  }
}

async function openLocalBranchPane() {
  previousModalTab = "commits";
  showSubPane("commit-modal-tab-branch", "ブランチ");
  const listEl = $("branch-pane-list");
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';

  await loadBranches();

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const currentBranch = ws ? ws.branch : null;

  listEl.innerHTML = "";
  for (const b of cachedBranches) {
    const item = document.createElement("div");
    item.className = "branch-item";
    if (b === currentBranch) {
      item.classList.add("current");
    }

    const nameEl = document.createElement("div");
    nameEl.className = "branch-item-name";
    nameEl.textContent = b === currentBranch ? `${b} ✓` : b;
    if (b !== currentBranch) {
      nameEl.addEventListener("click", async () => {
        closeSubPane();
        await checkoutBranch(b);
        updateGitLogBranchLabel();
        await reloadGitLog();
      });
    }
    item.appendChild(nameEl);

    if (b !== currentBranch) {
      const actions = document.createElement("div");
      actions.className = "branch-item-actions";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "commit-action-item commit-action-danger";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteBranch(b, false, delBtn);
      });
      actions.appendChild(delBtn);
      item.appendChild(actions);
    }

    listEl.appendChild(item);
  }

  const remoteBtn = document.createElement("div");
  remoteBtn.className = "branch-item branch-item-action";
  remoteBtn.textContent = "リモートブランチを表示...";
  remoteBtn.addEventListener("click", () => openRemoteBranchPane());
  listEl.appendChild(remoteBtn);
}

function renderDirtyEntry(listEl) {
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const isDirty = ws && ws.clean === false;
  const entry = document.createElement("div");
  entry.className = "git-log-entry git-log-dirty";
  if (!isDirty) entry.classList.add("git-log-clean");
  let badgeHtml = "";
  if (isDirty) {
    let statParts = [];
    if (ws.changed_files > 0) statParts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
    if (ws.insertions > 0) statParts.push(`<span class="stat-add">+${ws.insertions}</span>`);
    if (ws.deletions > 0) statParts.push(`<span class="stat-del">-${ws.deletions}</span>`);
    const statText = statParts.length > 0 ? statParts.join(" ") : "\u25cf";
    badgeHtml = `<span class="git-log-entry-refs"><span class="git-ref git-ref-dirty">${statText}</span></span>`;
  }
  entry.innerHTML =
    `<span class="git-log-entry-body">` +
      badgeHtml +
      `<span class="git-log-entry-row1"><span class="git-log-entry-msg">${isDirty ? "未コミットの変更" : "変更なし"}</span></span>` +
    `</span>`;
  if (isDirty) {
    entry.addEventListener("click", () => {
      previousModalTab = "commits";
      showDiffPane("未コミットの変更");
      loadDiffTab();
    });
  }
  listEl.appendChild(entry);
}

async function reloadGitLog() {
  if (!selectedWorkspace) return;

  const listEl = $("git-log-list-modal");
  listEl.innerHTML = '<div class="git-log-entry-msg" style="color:var(--text-muted);padding:16px">読み込み中...</div>';

  gitLogLoaded = 0;
  isGitLogLoading = false;
  gitLogHasMore = true;
  gitLogSeenHashes.clear();

  try {
    const logRes = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_ENTRIES_PER_PAGE}`));

    listEl.innerHTML = "";

    if (!logRes) return;
    const data = await logRes.json();
    if (!logRes.ok || data.status !== "ok") {
      showToast(data.detail || data.stderr || "git log の読み込みに失敗しました");
      return;
    }
    if (!data.stdout) {
      listEl.innerHTML += '<div style="color:var(--text-muted);padding:16px">ログがありません</div>';
      return;
    }

    renderDirtyEntry(listEl);
    const count = renderGitLogEntries(listEl, data.stdout);
    gitLogLoaded = count;
    if (count < GIT_LOG_ENTRIES_PER_PAGE) {
      gitLogHasMore = false;
    }
  } catch (e) {
    listEl.innerHTML = "";
    showToast(`git log エラー: ${e.message}`);
  }
}

async function openStashPane() {
  if (!selectedWorkspace) return;

  previousModalTab = "commits";
  showSubPane("commit-modal-tab-stash", "Stash");
  const listEl = $("stash-pane-list");
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
    if (!res || !res.ok) { listEl.innerHTML = '<div class="clone-repo-loading">取得に失敗しました</div>'; return; }
    const data = await res.json();
    if (data.status !== "ok" || !data.entries || data.entries.length === 0) {
      listEl.innerHTML = '<div class="clone-repo-loading">stashはありません</div>';
      return;
    }
    listEl.innerHTML = "";
    for (const entry of data.entries) {
      const row = document.createElement("div");
      row.className = "stash-entry";

      const info = document.createElement("div");
      info.className = "stash-entry-info";
      info.innerHTML =
        `<span class="stash-entry-ref">${escapeHtml(entry.ref)}</span>` +
        `<span class="stash-entry-msg">${escapeHtml(entry.message)}</span>` +
        `<span class="stash-entry-time">${escapeHtml(entry.time)}</span>`;
      row.appendChild(info);

      const actions = document.createElement("div");
      actions.className = "stash-entry-actions";

      const popBtn = document.createElement("button");
      popBtn.type = "button";
      popBtn.className = "commit-action-item";
      popBtn.textContent = "pop";
      popBtn.addEventListener("click", () => execStashRefAction("pop", entry.ref));
      actions.appendChild(popBtn);

      const dropBtn = document.createElement("button");
      dropBtn.type = "button";
      dropBtn.className = "commit-action-item commit-action-danger";
      dropBtn.textContent = "drop";
      dropBtn.addEventListener("click", () => execStashRefAction("drop", entry.ref));
      actions.appendChild(dropBtn);

      row.appendChild(actions);
      listEl.appendChild(row);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="clone-repo-loading">${escapeHtml(e.message)}</div>`;
  }
}

async function execStashRefAction(action, ref) {
  if (!selectedWorkspace) return;
  const label = action === "pop" ? `stash pop ${ref}` : `stash drop ${ref}`;
  if (!confirm(`${label} を実行しますか？`)) return;
  const endpoint = action === "pop" ? "stash-pop-index" : "stash-drop";
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/${endpoint}`), {
      method: "POST",
      body: { stash_ref: ref },
    });
    if (!res) return;
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${label} 完了`, "success");
    } else {
      showToast(`${label} 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`${label} エラー: ${e.message}`);
  }
  closeSubPane();
  await refreshAfterGitOp();
  await reloadGitLog();
}

let isGitLogFilesLoaded = false;

let previousModalTab = "commits";

function switchCommitModalTab(tab) {
  const allPanes = ["commit-modal-tab-commits", "commit-modal-tab-files", "commit-modal-tab-diff", "commit-modal-tab-stash", "commit-modal-tab-branch"];
  const titleEl = $("git-log-modal-title");
  titleEl.textContent = "履歴";
  titleEl.classList.remove("split-modal-title-back");
  titleEl.onclick = null;
  for (const id of allPanes) {
    const pane = $(id);
    if (pane) pane.style.display = "none";
  }
  $("commit-modal-tab-" + tab).style.display = "";
}

function openFileBrowserPane() {
  previousModalTab = "commits";
  showSubPane("commit-modal-tab-files", "ファイル");
  if (!isGitLogFilesLoaded) {
    isGitLogFilesLoaded = true;
    loadDirectoryInModal("");
  }
}

function showSubPane(paneId, title) {
  const allPanes = ["commit-modal-tab-commits", "commit-modal-tab-files", "commit-modal-tab-diff", "commit-modal-tab-stash", "commit-modal-tab-branch"];
  for (const id of allPanes) {
    const pane = $(id);
    if (pane) pane.style.display = "none";
  }
  $(paneId).style.display = "";
  const titleEl = $("git-log-modal-title");
  titleEl.textContent = "";
  titleEl.classList.add("split-modal-title-back");
  const arrow = document.createElement("span");
  arrow.className = "mdi mdi-arrow-left";
  titleEl.appendChild(arrow);
  titleEl.appendChild(document.createTextNode(" " + title));
  titleEl.onclick = () => closeSubPane();
}

function closeSubPane() {
  switchCommitModalTab(previousModalTab);
}

function showDiffPane(title) {
  showSubPane("commit-modal-tab-diff", title || "未コミットの変更");
}

function closeDiffPane() {
  closeSubPane();
}

async function openGitLogModal() {
  if (!selectedWorkspace) return;
  isGitLogFilesLoaded = false;
  switchCommitModalTab("commits");
  $("git-log-modal").style.display = "flex";
  updateGitLogBranchLabel();
  await reloadGitLog();
}

async function openGitLogModalFiles() {
  if (!selectedWorkspace) return;
  isGitLogFilesLoaded = false;
  $("git-log-modal").style.display = "flex";
  updateGitLogBranchLabel();
  openFileBrowserPane();
}

async function execStashAction(action) {
  if (!selectedWorkspace) return;
  const endpoint = action === "pop" ? "stash-pop" : "stash";
  const label = action === "pop" ? "stash pop" : "stash";
  if (!confirm(`${label} を実行しますか？`)) return;
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/${endpoint}`), { method: "POST" });
    if (!res) return;
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${label} 完了`, "success");
    } else {
      showToast(`${label} 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`${label} エラー: ${e.message}`);
  }
  closeGitLogModal();
  await refreshAfterGitOp();
}

async function openRemoteBranchPane() {
  previousModalTab = "commits";
  showSubPane("commit-modal-tab-branch", "リモートブランチ");
  const listEl = $("branch-pane-list");
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/branches/remote"));
    if (!res) return;
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
      } else if (cachedBranches.includes(branch)) {
        item.classList.add("local-exists");
      }

      const nameEl = document.createElement("div");
      nameEl.className = "branch-item-name";
      nameEl.textContent = branch === currentBranch ? `${branch} ✓` : branch;
      if (branch !== currentBranch) {
        nameEl.addEventListener("click", async () => {
          closeSubPane();
          await checkoutBranch(branch);
          updateGitLogBranchLabel();
          await reloadGitLog();
        });
      }
      item.appendChild(nameEl);

      if (branch !== currentBranch) {
        const actions = document.createElement("div");
        actions.className = "branch-item-actions";
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "commit-action-item commit-action-danger";
        delBtn.textContent = "削除";
        delBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await deleteBranch(branch, true, delBtn);
        });
        actions.appendChild(delBtn);
        item.appendChild(actions);
      }

      listEl.appendChild(item);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="clone-repo-error">${escapeHtml(e.message)}</div>`;
  }
}

async function deleteBranch(branch, remote, triggerBtn) {
  if (!selectedWorkspace) return;
  const label = remote ? `リモートブランチ ${branch}` : `ブランチ ${branch}`;
  if (!confirm(`${label} を削除しますか？`)) return;

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.classList.add("running");
  }

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/delete-branch"), {
      method: "POST",
      body: { branch, remote },
    });
    if (!res) return;
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${label} を削除しました`, "success");
    } else {
      showToast(`削除失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
  } finally {
    if (triggerBtn) {
      triggerBtn.classList.remove("running");
      triggerBtn.disabled = false;
    }
  }
  if (remote) {
    await openRemoteBranchPane();
  } else {
    await openLocalBranchPane();
  }
}
