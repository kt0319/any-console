let JOBS = {};

let token = localStorage.getItem("pi_console_token") || "";
let selectedJob = null;
let allWorkspaces = [];
let selectedWorkspace = localStorage.getItem("pi_console_workspace") || null;
let hiddenWorkspaces = JSON.parse(localStorage.getItem("hidden_workspaces") || "[]");
let commitLogOpen = false;
let commitLogContent = "";
let runningJobName = null;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatCommitMessage(message, githubUrl) {
  if (!message) return "-";
  const escaped = escapeHtml(message);
  if (!githubUrl) return escaped;

  const base = escapeHtml(githubUrl.replace(/\/+$/, ""));
  return escaped.replace(/#(\d+)/g, `<a class="commit-issue-link" href="${base}/issues/$1" target="_blank" rel="noopener">#$1</a>`);
}

function formatCommitTime(timeText) {
  if (!timeText) return "-";
  const d = new Date(timeText);
  if (Number.isNaN(d.getTime())) return escapeHtml(timeText);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function showLogin() {
  $("login-screen").style.display = "flex";
  $("app-screen").style.display = "none";
}

function showApp() {
  $("login-screen").style.display = "none";
  $("app-screen").style.display = "flex";
}

async function checkToken() {
  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job: "__ping__" }),
    });
    // 400 = token valid but job unknown, 401 = invalid token
    if (res.status === 401) return false;
    return true;
  } catch {
    return false;
  }
}

async function login() {
  const input = $("token-input");
  token = input.value.trim();
  if (!token) return;

  const valid = await checkToken();
  if (valid) {
    localStorage.setItem("pi_console_token", token);
    $("login-error").style.display = "none";
    showApp();
    await initApp();
  } else {
    $("login-error").textContent = "認証に失敗しました";
    $("login-error").style.display = "block";
    token = "";
  }
}

async function initApp() {
  await loadWorkspaces();
  if (selectedWorkspace && !visibleWorkspaces().some((ws) => ws.name === selectedWorkspace)) {
    selectedWorkspace = null;
    localStorage.removeItem("pi_console_workspace");
  }
  renderWorkspaceSelects();
  await updateHeaderInfo();
  await loadJobsForWorkspace();
  renderJobList();
}

async function loadWorkspaces() {
  try {
    const res = await fetch("/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      allWorkspaces = await res.json();
      renderWorkspaceSelects();
    }
  } catch {
    allWorkspaces = [];
  }
}

function visibleWorkspaces() {
  return allWorkspaces.filter((ws) => !hiddenWorkspaces.includes(ws.name));
}

function renderWorkspaceSelects() {
  renderHeaderWsSelect();
}

function renderHeaderWsSelect() {
  const select = $("header-ws-select");
  select.innerHTML = '<option value="">Workspace...</option>';
  for (const ws of visibleWorkspaces()) {
    const opt = document.createElement("option");
    opt.value = ws.name;
    opt.textContent = ws.name;
    if (ws.name === selectedWorkspace) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderCommitMessagePanel(timeText, messageHtml) {
  const mainCommitMessageEl = $("main-commit-message");
  if (!mainCommitMessageEl.querySelector(".commit-message-line")) {
    mainCommitMessageEl.innerHTML = `
      <div class="commit-message-line">
        <span class="commit-message-time"></span>
        <span class="commit-message-text"></span>
      </div>
      <div class="commit-log-wrap">
        <div class="commit-log-list"></div>
      </div>
    `;
  }

  const timeEl = mainCommitMessageEl.querySelector(".commit-message-time");
  const textEl = mainCommitMessageEl.querySelector(".commit-message-text");
  const logListEl = mainCommitMessageEl.querySelector(".commit-log-list");

  if (timeEl) timeEl.textContent = timeText;
  if (textEl) textEl.innerHTML = messageHtml;
  if (logListEl) {
    logListEl.innerHTML = commitLogContent || '<div class="commit-log-item muted">loading...</div>';
  }

  mainCommitMessageEl.classList.toggle("log-open", commitLogOpen);
}

function updateGithubLink(ws) {
  const link = $("github-link");
  if (!ws || !ws.github_url) {
    link.style.display = "none";
    return;
  }
  const branch = ws.branch || "main";
  link.href = `${ws.github_url}/tree/${encodeURIComponent(branch)}`;
  link.style.display = "flex";
}

async function updateHeaderInfo() {
  const mainGitStatusEl = $("main-git-status");
  const mainCommitMessageEl = $("main-commit-message");

  if (!selectedWorkspace) {
    commitLogOpen = false;
    commitLogContent = "";
    mainCommitMessageEl.classList.remove("clickable");
    mainGitStatusEl.innerHTML = "";
    mainCommitMessageEl.innerHTML = '<div class="commit-placeholder">ワークスペースを選択してください</div>';
    $("clean-dirty-status").innerHTML = "";
    $("branch-select").innerHTML = '<option value="">branch...</option>';
    updateGithubLink(null);
    return;
  }
  mainCommitMessageEl.classList.add("clickable");

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);

  let cleanDirtyHtml = "";
  if (ws) {
    if (ws.clean === false) {
      cleanDirtyHtml = '<span class="git-badge dirty" id="dirty-badge">\u25cf</span>';
    } else if (ws.clean === true) {
      cleanDirtyHtml = '<span class="git-badge clean">\u25cf</span>';
    }
  }
  $("clean-dirty-status").innerHTML = cleanDirtyHtml;

  const dirtyBadge = $("dirty-badge");
  if (dirtyBadge) {
    dirtyBadge.addEventListener("click", openDiffModal);
  }

  let statusHtml = "";
  if (ws) {
    if (ws.ahead > 0) {
      statusHtml += `<span class="git-badge ahead">\u2191${ws.ahead}</span>`;
    }
    if (ws.behind > 0) {
      statusHtml += `<span class="git-badge behind">\u2193${ws.behind}</span>`;
    }
  }
  const statusLine = statusHtml;
  const commitMessage = formatCommitMessage(
    ws ? ws.last_commit_message : "",
    ws ? ws.github_url : "",
  );
  const commitTime = ws && ws.last_commit ? formatCommitTime(ws.last_commit) : "-";

  updateGithubLink(ws);
  mainGitStatusEl.innerHTML = statusLine;

  renderCommitMessagePanel(commitTime, commitMessage);

  await loadBranches();
}

async function loadJobsForWorkspace() {
  if (!selectedWorkspace) {
    JOBS = {};
    selectedJob = null;
    renderJobList();
    $("detail-section").style.display = "none";
    $("output").innerHTML = '<div class="empty-state"></div>';
    return;
  }

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem("pi_console_token");
      showLogin();
      return;
    }
    if (!res.ok) {
      JOBS = {};
    } else {
      JOBS = await res.json();
    }
  } catch {
    JOBS = {};
  }

  if (!JOBS[selectedJob]) {
    const names = Object.keys(JOBS);
    selectedJob = names.length > 0 ? names[0] : null;
  }
  renderJobList();
  if (selectedJob) {
    renderDetail();
  } else {
    $("detail-section").style.display = "none";
    $("output").innerHTML = '<div class="empty-state">このWorkspaceに有効なjobがありません</div>';
  }
}

async function toggleCommitLogPanel() {
  if (!selectedWorkspace) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const commitMessage = formatCommitMessage(
    ws ? ws.last_commit_message : "",
    ws ? ws.github_url : "",
  );
  const commitTime = ws && ws.last_commit ? formatCommitTime(ws.last_commit) : "-";

  if (commitLogOpen) {
    commitLogOpen = false;
    renderCommitMessagePanel(commitTime, commitMessage);
    return;
  }

  commitLogOpen = true;
  commitLogContent = "";
  renderCommitMessagePanel(commitTime, commitMessage);

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/git-log?limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem("pi_console_token");
      showLogin();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      const msg = escapeHtml(data.detail || data.stderr || "failed to load git log");
      commitLogContent = `<div class="commit-log-item error">${msg}</div>`;
    } else if (!data.stdout) {
      commitLogContent = '<div class="commit-log-item muted">log is empty</div>';
    } else {
      const lines = data.stdout
        .split("\n")
        .filter((line) => line.trim() !== "")
        .slice(0, 10);
      commitLogContent = lines
        .map((line) => `<div class="commit-log-item">${escapeHtml(line)}</div>`)
        .join("");
    }
    renderCommitMessagePanel(commitTime, commitMessage);
  } catch (e) {
    commitLogContent = `<div class="commit-log-item error">${escapeHtml(e.message)}</div>`;
    renderCommitMessagePanel(commitTime, commitMessage);
  }
}

async function loadBranches() {
  const selects = [$("branch-select")];
  for (const s of selects) {
    s.innerHTML = '<option value="">branch...</option>';
  }
  if (!selectedWorkspace) return;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/branches`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const branches = await res.json();
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    const currentBranch = ws ? ws.branch : null;

    for (const s of selects) {
      for (const b of branches) {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        if (b === currentBranch) opt.selected = true;
        s.appendChild(opt);
      }
    }
  } catch {}
}

async function checkoutBranch(branch) {
  if (!selectedWorkspace || !branch) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  if (ws && ws.branch === branch) return;

  $("output").innerHTML = '<div class="output-status"><span class="status-badge running">switching</span></div>';

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
      localStorage.removeItem("pi_console_token");
      showLogin();
      return;
    }

    const data = await res.json();
    const statusText = data.status || (res.ok ? "ok" : "error");
    const badgeClass = statusText === "ok" ? "ok" : "error";
    let html = `<div class="output-status"><span class="status-badge ${badgeClass}">${escapeHtml(statusText)}</span></div>`;
    if (!res.ok && data.detail) {
      html += `\n<span style="color:var(--error)">${escapeHtml(data.detail)}</span>`;
    }
    if (data.stdout) html += escapeHtml(data.stdout);
    if (data.stderr && statusText !== "ok") {
      html += `\n<span style="color:var(--error)">${escapeHtml(data.stderr)}</span>`;
    } else if (data.stderr) {
      html += escapeHtml(data.stderr);
    }
    $("output").innerHTML = html;

    if (statusText === "ok") {
      await loadWorkspaces();
      await updateHeaderInfo();
    }
  } catch (e) {
    $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`;
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

async function openDiffModal() {
  if (!selectedWorkspace) return;

  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  fileList.innerHTML = '<span class="diff-file-tag">loading...</span>';
  diffContent.textContent = "";
  $("diff-modal").style.display = "flex";

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/diff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem("pi_console_token");
      showLogin();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      fileList.innerHTML = "";
      diffContent.textContent = data.detail || "diff の取得に失敗しました";
      return;
    }

    fileList.innerHTML = "";
    for (const f of data.files) {
      const tag = document.createElement("span");
      tag.className = "diff-file-tag";
      tag.textContent = f;
      fileList.appendChild(tag);
    }
    if (data.files.length === 0) {
      fileList.innerHTML = '<span class="diff-file-tag">変更ファイルなし</span>';
    }

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
}

function openSettings() {
  const list = $("ws-check-list");
  list.innerHTML = "";
  for (const ws of allWorkspaces) {
    const visible = !hiddenWorkspaces.includes(ws.name);
    const item = document.createElement("label");
    item.className = "ws-check-item";
    item.innerHTML = `<input type="checkbox" data-ws="${escapeHtml(ws.name)}" ${visible ? "checked" : ""} />${escapeHtml(ws.name)}`;
    item.querySelector("input").addEventListener("change", (e) => {
      toggleWorkspace(ws.name, e.target.checked);
    });
    list.appendChild(item);
  }
  $("settings-modal").style.display = "flex";
}

function closeSettings() {
  $("settings-modal").style.display = "none";
}

function toggleWorkspace(name, visible) {
  let selectionCleared = false;
  if (visible) {
    hiddenWorkspaces = hiddenWorkspaces.filter((n) => n !== name);
  } else {
    if (!hiddenWorkspaces.includes(name)) {
      hiddenWorkspaces.push(name);
    }
    if (selectedWorkspace === name) {
      selectedWorkspace = null;
      selectionCleared = true;
    }
  }
  localStorage.setItem("hidden_workspaces", JSON.stringify(hiddenWorkspaces));
  renderWorkspaceSelects();
  if (selectionCleared) {
    updateHeaderInfo();
    loadJobsForWorkspace();
  }
}

function renderJobList() {
  const container = $("job-cards");
  container.innerHTML = "";
  for (const [name, job] of Object.entries(JOBS)) {
    const card = document.createElement("div");
    const isRunning = runningJobName === name;
    const sourceClass = job.source === "workspace" ? " workspace" : " common";
    card.className = `job-card${sourceClass}${selectedJob === name ? " active" : ""}${isRunning ? " running" : ""}`;
    const label = job.label || name;
    let inner = `<div class="job-label">${escapeHtml(label)}</div>`;
    if (isRunning) inner += '<span class="job-state" aria-hidden="true">◌</span>';
    card.innerHTML = inner;
    card.addEventListener("click", () => selectJob(name));
    if (job.source === "workspace") {
      let holdTimer = null;
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        deleteJob(name);
      });
      card.addEventListener("touchstart", () => {
        holdTimer = setTimeout(() => deleteJob(name), 600);
      }, { passive: true });
      card.addEventListener("touchend", () => clearTimeout(holdTimer));
      card.addEventListener("touchmove", () => clearTimeout(holdTimer));
    }
    container.appendChild(card);
  }
  if (selectedWorkspace) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "job-add-btn";
    addBtn.title = "ジョブ追加";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", openJobCreateModal);
    container.appendChild(addBtn);
  }
  updateJobRunButton();
}

function openJobCreateModal() {
  $("job-create-name").value = "";
  $("job-create-label").value = "";
  $("job-create-script").value = "";
  $("job-create-error").style.display = "none";
  $("job-create-modal").style.display = "flex";
  $("job-create-name").focus();
}

function closeJobCreateModal() {
  $("job-create-modal").style.display = "none";
}

async function submitJobCreate() {
  const name = $("job-create-name").value.trim();
  const label = $("job-create-label").value.trim();
  const script = $("job-create-script").value;
  const errorEl = $("job-create-error");

  if (!name) {
    errorEl.textContent = "ジョブ名を入力してください";
    errorEl.style.display = "block";
    return;
  }
  if (!script.trim()) {
    errorEl.textContent = "スクリプトを入力してください";
    errorEl.style.display = "block";
    return;
  }

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, label: label || name, script }),
    });
    if (res.status === 401) {
      localStorage.removeItem("pi_console_token");
      showLogin();
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.detail || "作成に失敗しました";
      errorEl.style.display = "block";
      return;
    }
    closeJobCreateModal();
    await loadJobsForWorkspace();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

async function deleteJob(jobName) {
  if (!selectedWorkspace) return;
  if (!confirm(`ジョブ '${jobName}' を削除しますか？`)) return;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/jobs/${encodeURIComponent(jobName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem("pi_console_token");
      showLogin();
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(data.detail || "削除に失敗しました")}`;
      return;
    }
    if (selectedJob === jobName) selectedJob = null;
    await loadJobsForWorkspace();
  } catch (e) {
    $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`;
  }
}

function updateJobRunButton() {
  const btn = $("job-run-main");
  if (!btn) return;
  const hasSelection = !!selectedJob;
  const isRunning = !!runningJobName;
  btn.disabled = !hasSelection || isRunning;
  btn.classList.toggle("running", isRunning);
  btn.innerHTML = isRunning ? "◌" : "&#9654;";
}

function selectJob(name) {
  selectedJob = name;
  renderJobList();
  renderDetail();
}

function extractCommands(content) {
  if (!content) return "";
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("#")) return false;
      if (trimmed === "set -euo pipefail") return false;
      if (trimmed === "set -eu") return false;
      if (trimmed === "set -e") return false;
      return true;
    })
    .join("\n")
    .trim();
}

function renderDetail() {
  const job = JOBS[selectedJob];
  if (!job) return;

  $("detail-section").style.display = "none";
  const commands = extractCommands(job.script_content || "");
  if (commands) {
    const preview = escapeHtml(commands.length > 500 ? commands.slice(0, 500) + "..." : commands);
    $("output").innerHTML = `<div class="empty-state"><pre class="script-preview">${preview}</pre></div>`;
  } else {
    $("output").innerHTML = `<div class="empty-state">${escapeHtml(job.script)}</div>`;
  }
}

function collectArgs() {
  const job = JOBS[selectedJob];
  const args = {};
  for (const arg of job.args) {
    if (arg.required && Array.isArray(arg.values) && arg.values.length > 0) {
      args[arg.name] = arg.values[0];
    }
  }
  return args;
}

async function runJob(jobName = null) {
  const targetJob = jobName || selectedJob;
  if (!targetJob) return;
  if (runningJobName) return;
  if (selectedJob !== targetJob) {
    selectedJob = targetJob;
  }
  renderJobList();

  const args = collectArgs();
  const job = JOBS[targetJob];

  for (const arg of job.args) {
    if (arg.required && !args[arg.name]) {
      $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(arg.name)} の既定値がありません`;
      return;
    }
  }

  runningJobName = targetJob;
  renderJobList();
  $("output").innerHTML = '<div class="output-status"><span class="status-badge running">running</span></div>';

  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job: targetJob, args, workspace: selectedWorkspace }),
    });

    if (res.status === 401) {
      localStorage.removeItem("pi_console_token");
      showLogin();
      return;
    }

    const data = await res.json();
    const badgeClass = data.status === "ok" ? "ok" : "error";
    let html = `<div class="output-status"><span class="status-badge ${badgeClass}">${escapeHtml(data.status)}</span> exit: ${data.exit_code}</div>`;

    if (data.stdout) {
      html += escapeHtml(data.stdout);
    }
    if (data.stderr) {
      html += `\n<span style="color:var(--error)">${escapeHtml(data.stderr)}</span>`;
    }

    if (targetJob === "terminal" && data.status === "ok" && data.terminal_url) {
      const w = window.open(data.terminal_url, "_blank", "noopener");
      if (!w) {
        html += "\n<span style=\"color:var(--warning)\">terminal popup blocked</span>";
      }
      if (data.expires_in) {
        html += `\nterminal expires in ${escapeHtml(String(data.expires_in))}s`;
      }
    }

    $("output").innerHTML = html;
  } catch (e) {
    $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`;
  } finally {
    runningJobName = null;
    renderJobList();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  $("login-btn").addEventListener("click", login);
  $("token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("job-run-main").addEventListener("click", () => runJob());
  $("settings-btn").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", closeSettings);
  $("diff-close").addEventListener("click", closeDiffModal);
  $("job-create-cancel").addEventListener("click", closeJobCreateModal);
  $("job-create-submit").addEventListener("click", submitJobCreate);
  $("header-ws-select").addEventListener("change", async (e) => {
    selectedWorkspace = e.target.value || null;
    if (selectedWorkspace) {
      localStorage.setItem("pi_console_workspace", selectedWorkspace);
    } else {
      localStorage.removeItem("pi_console_workspace");
    }
    commitLogOpen = false;
    commitLogContent = "";
    await updateHeaderInfo();
    await loadJobsForWorkspace();
  });
  $("branch-select").addEventListener("change", (e) => {
    const branch = e.target.value;
    if (branch) checkoutBranch(branch);
  });
  $("main-commit-message").addEventListener("click", (e) => {
    if (e.target.closest(".commit-issue-link")) return;
    if (!e.target.closest(".commit-message-line")) return;
    toggleCommitLogPanel();
  });

  if (token) {
    const valid = await checkToken();
    if (valid) {
      showApp();
      await initApp();
    } else {
      showLogin();
    }
  } else {
    showLogin();
  }
});
