async function loadJobsForWorkspace() {
  if (!selectedWorkspace) {
    JOBS = {};
    selectedJob = null;
    renderJobMenu();
    $("output").innerHTML = '<div class="empty-state"></div>';
    return;
  }

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
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

  selectedJob = null;
  renderJobMenu();
  renderTabBar();
}

function renderJobMenu() {
  const dropdown = $("menu-dropdown");
  dropdown.querySelectorAll(".menu-dynamic").forEach((el) => el.remove());

  if (!selectedWorkspace) return;

  const refNode = $("menu-settings");
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const currentBranch = ws ? ws.branch : null;

  if (cachedBranches.length > 0) {
    const branchLabel = document.createElement("div");
    branchLabel.className = "menu-section-label menu-dynamic";
    branchLabel.textContent = "ブランチ";
    dropdown.insertBefore(branchLabel, refNode);

    for (const b of cachedBranches) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-item menu-dynamic";
      btn.textContent = b === currentBranch ? `${b} ✓` : b;
      if (b === currentBranch) btn.style.color = "var(--accent)";
      btn.addEventListener("click", () => {
        closeMenu();
        if (b !== currentBranch) checkoutBranch(b);
      });
      dropdown.insertBefore(btn, refNode);
    }

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "menu-item menu-dynamic";
    moreBtn.style.color = "var(--text-muted)";
    moreBtn.textContent = "more...";
    moreBtn.addEventListener("click", () => {
      closeMenu();
      openBranchModal();
    });
    dropdown.insertBefore(moreBtn, refNode);

    const branchSep = document.createElement("div");
    branchSep.className = "menu-separator menu-dynamic";
    dropdown.insertBefore(branchSep, refNode);
  }

  const entries = Object.entries(JOBS).filter(([name]) => name !== "terminal");
  if (entries.length > 0) {
    const jobLabel = document.createElement("div");
    jobLabel.className = "menu-section-label menu-dynamic";
    jobLabel.textContent = "ジョブ";
    dropdown.insertBefore(jobLabel, refNode);

    for (const [name, job] of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-item menu-dynamic";
      const label = job.label || name;
      const isRunning = runningJobName === name;
      if (job.open_url) {
        btn.innerHTML = `<span class="menu-job-url-icon">⧉</span> ${escapeHtml(label)}`;
      } else if (isRunning) {
        btn.innerHTML = `${escapeHtml(label)} <span class="job-state">◌</span>`;
      } else {
        btn.textContent = label;
      }
      btn.addEventListener("click", () => {
        closeMenu();
        if (job.open_url) {
          window.open(job.open_url, "_blank");
        } else {
          openJobConfirmModal(name);
        }
      });
      let holdTimer = null;
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        closeMenu();
        deleteJob(name);
      });
      btn.addEventListener("touchstart", () => {
        holdTimer = setTimeout(() => { closeMenu(); deleteJob(name); }, 600);
      }, { passive: true });
      btn.addEventListener("touchend", () => clearTimeout(holdTimer));
      btn.addEventListener("touchmove", () => clearTimeout(holdTimer));
      dropdown.insertBefore(btn, refNode);
    }
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "menu-item menu-dynamic";
  addBtn.style.color = "var(--text-muted)";
  addBtn.textContent = "+ ジョブ追加";
  addBtn.addEventListener("click", () => {
    closeMenu();
    openJobCreateModal();
  });
  dropdown.insertBefore(addBtn, refNode);

  const sep = document.createElement("div");
  sep.className = "menu-separator menu-dynamic";
  dropdown.insertBefore(sep, refNode);
}

function openJobConfirmModal(name) {
  const job = JOBS[name];
  if (!job) return;
  selectedJob = name;
  $("job-confirm-title").textContent = job.label || name;

  const argsContainer = $("job-confirm-args");
  argsContainer.innerHTML = "";
  if (job.args && job.args.length > 0) {
    for (const arg of job.args) {
      const group = document.createElement("div");
      group.className = "arg-group";
      const label = document.createElement("label");
      label.className = "arg-label";
      label.textContent = arg.name;
      if (arg.required) label.innerHTML += ' <span class="required">*</span>';
      group.appendChild(label);

      if (Array.isArray(arg.values) && arg.values.length > 0) {
        const radioGroup = document.createElement("div");
        radioGroup.className = "radio-group";
        for (const val of arg.values) {
          const lbl = document.createElement("label");
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `confirm-arg-${arg.name}`;
          radio.value = val;
          if (val === arg.values[0]) radio.checked = true;
          const span = document.createElement("span");
          span.className = "radio-btn";
          span.textContent = val;
          lbl.appendChild(radio);
          lbl.appendChild(span);
          radioGroup.appendChild(lbl);
        }
        group.appendChild(radioGroup);
      }
      argsContainer.appendChild(group);
    }
  } else {
    const commands = extractCommands(job.script_content || "");
    if (commands) {
      const preview = escapeHtml(commands.length > 300 ? commands.slice(0, 300) + "..." : commands);
      argsContainer.innerHTML = `<pre class="script-preview">${preview}</pre>`;
    }
  }

  $("job-confirm-modal").style.display = "flex";
}

function closeJobConfirmModal() {
  $("job-confirm-modal").style.display = "none";
}

function collectConfirmArgs() {
  const job = JOBS[selectedJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    const checked = document.querySelector(`input[name="confirm-arg-${arg.name}"]:checked`);
    if (checked) args[arg.name] = checked.value;
  }
  return args;
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

function collectArgs() {
  const job = JOBS[selectedJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    if (arg.required && Array.isArray(arg.values) && arg.values.length > 0) {
      args[arg.name] = arg.values[0];
    }
  }
  return args;
}

async function runJob(jobName = null, argsOverride = null) {
  const targetJob = jobName || selectedJob;
  if (!targetJob) return;
  const isTerminal = targetJob === "terminal";
  if (isTerminal) {
    if (launchingTerminal) return;
  } else {
    if (runningJobName) return;
  }
  if (selectedJob !== targetJob) {
    selectedJob = targetJob;
  }
  renderJobMenu();

  const args = argsOverride || collectArgs();
  const job = JOBS[targetJob] || {};
  const tabLabel = job.label || targetJob;
  const outputTabId = isTerminal ? `output-term-${Date.now()}` : `output-${targetJob}`;

  for (const arg of (job.args || [])) {
    if (arg.required && !args[arg.name]) {
      setOutputTab(outputTabId, tabLabel, `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(arg.name)} の既定値がありません`);
      return;
    }
  }

  if (isTerminal) {
    launchingTerminal = true;
  } else {
    runningJobName = targetJob;
  }
  renderJobMenu();
  setOutputTab(outputTabId, tabLabel, '<div class="output-status"><span class="status-badge running">running</span></div>');

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
      await handleUnauthorized();
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

    if (isTerminal && data.status === "ok" && data.terminal_url) {
      removeTab(outputTabId);
      addTerminalTab(data.terminal_url, selectedWorkspace);
      return;
    }

    setOutputTab(outputTabId, tabLabel, html);
  } catch (e) {
    setOutputTab(outputTabId, tabLabel, `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`);
  } finally {
    if (isTerminal) {
      launchingTerminal = false;
    } else {
      runningJobName = null;
    }
    renderJobMenu();
    loadWorkspaces().then(() => updateHeaderInfo());
  }
}

function openJobCreateModal() {
  $("job-create-name").value = "";
  $("job-create-label").value = "";
  $("job-create-script").value = "";
  $("job-create-url").value = "";
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
  const openUrl = $("job-create-url").value.trim();
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
      body: JSON.stringify({ name, label: label || name, script, open_url: openUrl }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
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
      await handleUnauthorized();
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
