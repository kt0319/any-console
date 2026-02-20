const JOBS = {
  deploy: {
    description: "デプロイ実行",
    args: [
      { name: "env", values: ["stg", "prod"], required: true },
      { name: "service", values: ["api", "web"], required: true },
    ],
  },
  docker: {
    description: "Docker操作",
    args: [
      { name: "action", values: ["up", "down", "restart", "logs"], required: true },
      { name: "service", values: ["api", "web", "db"], required: false },
    ],
  },
  backup: {
    description: "バックアップ実行",
    args: [
      { name: "target", values: ["db", "files", "all"], required: true },
    ],
  },
  status: {
    description: "システムステータス確認",
    args: [],
  },
};

let token = localStorage.getItem("pi_console_token") || "";
let selectedJob = null;
let allWorkspaces = [];
let selectedWorkspace = null;
let hiddenWorkspaces = JSON.parse(localStorage.getItem("hidden_workspaces") || "[]");

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
  $("connection-status").textContent = "Connected";
  $("connection-status").className = "connected";
  await loadWorkspaces();
  renderJobList();
}

async function loadWorkspaces() {
  try {
    const res = await fetch("/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      allWorkspaces = await res.json();
      renderWorkspaceCards();
    }
  } catch {
    allWorkspaces = [];
  }
}

function visibleWorkspaces() {
  return allWorkspaces.filter((name) => !hiddenWorkspaces.includes(name));
}

function renderWorkspaceCards() {
  const container = $("ws-cards");
  container.innerHTML = "";
  for (const name of visibleWorkspaces()) {
    const card = document.createElement("div");
    card.className = `ws-card${selectedWorkspace === name ? " active" : ""}`;
    card.textContent = name;
    card.addEventListener("click", () => {
      selectedWorkspace = selectedWorkspace === name ? null : name;
      renderWorkspaceCards();
      renderMobileWsSelector();
    });
    container.appendChild(card);
  }
  renderMobileWsSelector();
}

function renderMobileWsSelector() {
  const container = $("mobile-ws-selector");
  container.innerHTML = "";
  for (const name of visibleWorkspaces()) {
    const pill = document.createElement("div");
    pill.className = `job-pill${selectedWorkspace === name ? " active" : ""}`;
    pill.textContent = name;
    pill.addEventListener("click", () => {
      selectedWorkspace = selectedWorkspace === name ? null : name;
      renderWorkspaceCards();
      renderMobileWsSelector();
    });
    container.appendChild(pill);
  }
}

function openSettings() {
  const list = $("ws-check-list");
  list.innerHTML = "";
  for (const name of allWorkspaces) {
    const visible = !hiddenWorkspaces.includes(name);
    const item = document.createElement("label");
    item.className = "ws-check-item";
    item.innerHTML = `<input type="checkbox" data-ws="${escapeHtml(name)}" ${visible ? "checked" : ""} />${escapeHtml(name)}`;
    item.querySelector("input").addEventListener("change", (e) => {
      toggleWorkspace(name, e.target.checked);
    });
    list.appendChild(item);
  }
  $("settings-modal").style.display = "flex";
}

function closeSettings() {
  $("settings-modal").style.display = "none";
}

function toggleWorkspace(name, visible) {
  if (visible) {
    hiddenWorkspaces = hiddenWorkspaces.filter((n) => n !== name);
  } else {
    if (!hiddenWorkspaces.includes(name)) {
      hiddenWorkspaces.push(name);
    }
    if (selectedWorkspace === name) {
      selectedWorkspace = null;
    }
  }
  localStorage.setItem("hidden_workspaces", JSON.stringify(hiddenWorkspaces));
  renderWorkspaceCards();
}

function renderJobList() {
  const container = $("job-cards");
  container.innerHTML = "";
  for (const [name, job] of Object.entries(JOBS)) {
    const card = document.createElement("div");
    card.className = `job-card${selectedJob === name ? " active" : ""}`;
    card.innerHTML = `
      <div class="job-name">${escapeHtml(name)}</div>
      <div class="job-desc">${escapeHtml(job.description)}</div>
    `;
    card.addEventListener("click", () => selectJob(name));
    container.appendChild(card);
  }
  renderMobileJobSelector();
}

function renderMobileJobSelector() {
  const container = $("mobile-job-selector");
  container.innerHTML = "";
  for (const [name, job] of Object.entries(JOBS)) {
    const pill = document.createElement("div");
    pill.className = `job-pill${selectedJob === name ? " active" : ""}`;
    pill.textContent = name;
    pill.addEventListener("click", () => selectJob(name));
    container.appendChild(pill);
  }
}

function selectJob(name) {
  selectedJob = name;
  renderJobList();
  renderDetail();
}

function renderDetail() {
  const job = JOBS[selectedJob];
  if (!job) return;

  $("detail-title").textContent = selectedJob;
  $("detail-desc").textContent = job.description;

  const argsContainer = $("args-container");
  argsContainer.innerHTML = "";

  for (const arg of job.args) {
    const group = document.createElement("div");
    group.className = "arg-group";

    const requiredMark = arg.required ? '<span class="required">*</span>' : "";
    group.innerHTML = `<span class="arg-label">${escapeHtml(arg.name)}${requiredMark}</span>`;

    const radioGroup = document.createElement("div");
    radioGroup.className = "radio-group";

    if (!arg.required) {
      radioGroup.innerHTML += `
        <label>
          <input type="radio" name="arg-${arg.name}" value="" checked />
          <span class="radio-btn">なし</span>
        </label>
      `;
    }

    for (const val of arg.values) {
      const checked = arg.required && val === arg.values[0] ? " checked" : "";
      radioGroup.innerHTML += `
        <label>
          <input type="radio" name="arg-${arg.name}" value="${escapeHtml(val)}"${checked} />
          <span class="radio-btn">${escapeHtml(val)}</span>
        </label>
      `;
    }

    group.appendChild(radioGroup);
    argsContainer.appendChild(group);
  }

  $("detail-section").style.display = "block";
  $("run-btn").disabled = false;
  $("output").innerHTML = '<div class="empty-state">実行結果がここに表示されます</div>';
}

function collectArgs() {
  const job = JOBS[selectedJob];
  const args = {};
  for (const arg of job.args) {
    const selected = document.querySelector(`input[name="arg-${arg.name}"]:checked`);
    if (selected && selected.value) {
      args[arg.name] = selected.value;
    }
  }
  return args;
}

async function runJob() {
  if (!selectedJob) return;

  const args = collectArgs();
  const job = JOBS[selectedJob];

  for (const arg of job.args) {
    if (arg.required && !args[arg.name]) {
      $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(arg.name)} を選択してください`;
      return;
    }
  }

  $("run-btn").disabled = true;
  $("output").innerHTML = '<div class="output-status"><span class="status-badge running">running</span></div>';

  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job: selectedJob, args, workspace: selectedWorkspace }),
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

    $("output").innerHTML = html;
  } catch (e) {
    $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`;
  } finally {
    $("run-btn").disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  $("login-btn").addEventListener("click", login);
  $("token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("run-btn").addEventListener("click", runJob);
  $("settings-btn").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", closeSettings);

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
