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

async function refreshAfterGitOp() {
  await loadWorkspaces();
  await updateHeaderInfo();
}

async function gitFetch() {
  if (!selectedWorkspace) return;
  const fetchBtn = $("fetch-btn");
  if (fetchBtn.disabled) return;
  fetchBtn.disabled = true;
  fetchBtn.classList.add("running");
  try {
    await fetchWorkspace(selectedWorkspace);
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
  if (!confirm(`${selectedWorkspace} を ${label} しますか？`)) return;

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
  } catch {}
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

  const switchActions = buildBranchSwitchActions(branches);

  const actions = [
    ...switchActions,
    { label: "diff", cls: "", fn: () => openCommitDiffModal(hash, msg) },
    { label: "checkout -b", cls: "", fn: () => toggleCreateBranchArea(hash) },
    { label: "cherry-pick", cls: "", fn: () => execCommitAction("cherry-pick", hash) },
    { label: "revert", cls: "", fn: () => execCommitAction("revert", hash) },
    { label: "reset --soft", cls: "", fn: () => execCommitResetAction(hash, "soft") },
    { label: "reset --hard", cls: "commit-action-danger", fn: () => execCommitResetAction(hash, "hard") },
  ];

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
  diffOpenedFromGitLog = false;
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
  if (!selectedWorkspace || gitLogLoading || !gitLogHasMore) return;
  gitLogLoading = true;

  const listEl = $("git-log-list-modal");
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_PAGE_SIZE}&skip=${gitLogLoaded}`));
    if (!res) return;
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

function updateGitLogBranchLabel() {
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  $("git-log-branch-label").textContent = ws ? ws.branch : "";
  updateStashBtn();
}

async function updateStashBtn() {
  const btn = $("stash-btn");
  if (!btn) return;
  if (!selectedWorkspace) { btn.disabled = true; btn.textContent = "stash"; return; }
  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
    if (!res || !res.ok) { btn.disabled = true; btn.textContent = "stash"; return; }
    const data = await res.json();
    const count = (data.status === "ok" && data.entries) ? data.entries.length : 0;
    btn.textContent = count > 0 ? `stash (${count})` : "stash";
    btn.disabled = count === 0;
  } catch {
    btn.disabled = true;
    btn.textContent = "stash";
  }
}

async function openLocalBranchModal() {
  const modal = $("branch-modal");
  const listEl = $("branch-list");
  modal.querySelector("h3").textContent = "ブランチ";
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
  modal.style.display = "flex";

  await loadBranches();

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const currentBranch = ws ? ws.branch : null;

  listEl.innerHTML = "";
  for (const b of cachedBranches) {
    const item = document.createElement("div");
    item.className = "branch-item";
    if (b === currentBranch) {
      item.classList.add("current");
      item.textContent = `${b} ✓`;
    } else {
      item.textContent = b;
      item.addEventListener("click", async () => {
        modal.style.display = "none";
        await checkoutBranch(b);
        updateGitLogBranchLabel();
        await reloadGitLog();
      });
    }
    listEl.appendChild(item);
  }

  const remoteBtn = document.createElement("div");
  remoteBtn.className = "branch-item branch-item-action";
  remoteBtn.textContent = "リモートブランチを表示...";
  remoteBtn.addEventListener("click", () => openBranchModal());
  listEl.appendChild(remoteBtn);
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
    const logRes = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_PAGE_SIZE}`));

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

    const count = renderGitLogEntries(listEl, data.stdout);
    gitLogLoaded = count;
    if (count < GIT_LOG_PAGE_SIZE) {
      gitLogHasMore = false;
    }
  } catch (e) {
    listEl.innerHTML = "";
    showToast(`git log エラー: ${e.message}`);
  }
}

async function openStashPanel() {
  if (!selectedWorkspace) return;

  const existing = document.getElementById("stash-modal-overlay");
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement("div");
  overlay.id = "stash-modal-overlay";
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal stash-modal";

  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("h3");
  title.textContent = "Stash";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-scroll-body";
  body.innerHTML = '<div style="padding:16px;color:var(--text-muted)">読み込み中...</div>';
  modal.appendChild(body);

  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
    if (!res || !res.ok) { body.innerHTML = '<div style="padding:16px;color:var(--text-muted)">取得に失敗しました</div>'; return; }
    const data = await res.json();
    if (data.status !== "ok" || !data.entries || data.entries.length === 0) {
      body.innerHTML = '<div style="padding:16px;color:var(--text-muted)">stashはありません</div>';
      return;
    }
    renderStashList(body, data.entries, overlay);
  } catch (e) {
    body.innerHTML = `<div style="padding:16px;color:var(--text-muted)">${escapeHtml(e.message)}</div>`;
  }
}

function renderStashList(container, entries, overlay) {
  container.innerHTML = "";
  for (const entry of entries) {
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
    popBtn.className = "stash-action-btn";
    popBtn.textContent = "pop";
    popBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      overlay.remove();
      execStashRefAction("pop", entry.ref);
    });
    actions.appendChild(popBtn);

    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "stash-action-btn stash-action-danger";
    dropBtn.textContent = "drop";
    dropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      overlay.remove();
      execStashRefAction("drop", entry.ref);
    });
    actions.appendChild(dropBtn);

    row.appendChild(actions);
    container.appendChild(row);
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
  await refreshAfterGitOp();
  await reloadGitLog();
}

let commitModalFilesLoaded = false;

const COMMIT_MODAL_TAB_TITLES = { commits: "履歴", files: "ファイル", diff: "変更内容" };

function switchCommitModalTab(tab) {
  const commitsPane = $("commit-modal-tab-commits");
  const filesPane = $("commit-modal-tab-files");
  const diffPane = $("commit-modal-tab-diff");
  for (const btn of document.querySelectorAll(".commit-modal-tab")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  $("git-log-modal-title").textContent = COMMIT_MODAL_TAB_TITLES[tab] || "履歴";
  commitsPane.style.display = tab === "commits" ? "" : "none";
  filesPane.style.display = tab === "files" ? "" : "none";
  diffPane.style.display = tab === "diff" ? "" : "none";
  if (tab === "files" && !commitModalFilesLoaded) {
    commitModalFilesLoaded = true;
    loadDirectoryInModal("");
  }
}

async function openGitLogModal() {
  if (!selectedWorkspace) return;
  commitModalFilesLoaded = false;
  switchCommitModalTab("commits");
  $("git-log-modal").style.display = "flex";
  updateGitLogBranchLabel();
  await reloadGitLog();
}

async function openGitLogModalFiles() {
  if (!selectedWorkspace) return;
  commitModalFilesLoaded = false;
  switchCommitModalTab("files");
  $("git-log-modal").style.display = "flex";
  updateGitLogBranchLabel();
  commitModalFilesLoaded = true;
  await loadDirectoryInModal("");
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
  const closeBtn = container.querySelector(".file-browser-close");
  if (closeBtn) closeBtn.style.display = "none";
}

function renderDiffActions(container, hash, branches) {
  const closeDiffBeforeSwitch = () => closeGitLogModal();
  const switchActions = buildBranchSwitchActions(branches, closeDiffBeforeSwitch);

  const actions = [
    ...switchActions,
    { label: "checkout -b", cls: "", fn: () => { switchCommitModalTab("commits"); toggleCreateBranchArea(hash); } },
    { label: "cherry-pick", cls: "", fn: () => { if (!confirm("cherry-pick を実行しますか？")) return; closeGitLogModal(); execCommitAction("cherry-pick", hash); } },
    { label: "revert", cls: "", fn: () => { if (!confirm("revert を実行しますか？")) return; closeGitLogModal(); execCommitAction("revert", hash); } },
    { label: "reset --soft", cls: "", fn: () => { if (!confirm("reset --soft を実行しますか？")) return; closeGitLogModal(); execCommitResetAction(hash, "soft"); } },
    { label: "reset --hard", cls: "commit-action-danger", fn: () => { if (!confirm("reset --hard を実行しますか？\nこの操作は取り消せません。")) return; closeGitLogModal(); execCommitResetAction(hash, "hard"); } },
  ];

  renderActionButtons(container, actions);
  container.style.display = "flex";
}

async function openCommitDiffModal(commitHash, commitMsg, branches = []) {
  diffOpenedFromGitLog = true;
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  const actionsEl = $("diff-actions");
  fileList.innerHTML = '<span class="diff-file-tag">loading...</span>';
  diffContent.textContent = "";
  actionsEl.innerHTML = "";
  actionsEl.style.display = "none";
  $("diff-commit-form").style.display = "none";
  switchCommitModalTab("diff");
  if (commitMsg) $("git-log-modal-title").textContent = commitMsg;

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

async function openDiffModal() {
  if (!selectedWorkspace) return;
  diffOpenedFromGitLog = false;

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
  commitModalFilesLoaded = false;
  switchCommitModalTab("diff");
  $("git-log-modal").style.display = "flex";
  updateGitLogBranchLabel();

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
    await updateHeaderInfo();
  } catch (e) {
    showFormError("diff-commit-error", e.message);
  } finally {
    $("diff-commit-submit").disabled = false;
  }
}

function closeDiffModal() {
  $("diff-commit-form").style.display = "none";
  if (diffOpenedFromGitLog) {
    diffOpenedFromGitLog = false;
    switchCommitModalTab("commits");
  } else {
    closeGitLogModal();
  }
}

async function openBranchModal() {
  const modal = $("branch-modal");
  const listEl = $("branch-list");
  modal.querySelector("h3").textContent = "リモートブランチ";
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
  modal.style.display = "flex";

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
        item.textContent = `${branch} ✓`;
      } else if (cachedBranches.includes(branch)) {
        item.classList.add("local-exists");
        item.textContent = branch;
      } else {
        item.textContent = branch;
      }
      item.addEventListener("click", async () => {
        if (branch === currentBranch) return;
        $("branch-modal").style.display = "none";
        await checkoutBranch(branch);
        if ($("git-log-modal").style.display !== "none") {
          updateGitLogBranchLabel();
          await reloadGitLog();
        }
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
    } else {
      const fi = getFileIcon(entry.name);
      const style = fi.color ? ` style="color:${fi.color}"` : "";
      iconHtml = `<span class="file-browser-item-icon file-icon"${style}><i class="mdi ${fi.icon}"></i></span>`;
    }
    const sizeHtml = entry.type === "file" && entry.size != null
      ? `<span class="file-browser-item-size">${formatFileSize(entry.size)}</span>`
      : "";
    list += `<li class="file-browser-item" data-type="${entry.type}" data-path="${escapeHtml(entryPath)}">` +
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
  const closeBtn = container.querySelector(".file-browser-close");
  if (closeBtn) closeBtn.addEventListener("click", () => removeTab("file-browser"));
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

function buildFileContentHtml(path, data) {
  const parts = path.split("/");
  const breadcrumb = buildBreadcrumbHtml(parts);

  let body = "";
  if (data.binary) {
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

function openFileBrowser() {
  if (!selectedWorkspace) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const wsIcon = ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null;
  const folderIcon = { name: "mdi-folder", color: "" };
  setOutputTab("file-browser", "ファイル", fileBrowserMessage("読み込み中...", true), folderIcon, wsIcon, selectedWorkspace);
  loadDirectory("");
}
