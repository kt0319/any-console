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

  if (!selectedWorkspace) {
    renderSettingsMenuItems(dropdown, null);
    return;
  }

  const refNode = null;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const currentBranch = ws ? ws.branch : null;

  if (cachedBranches.length > 0) {
    const branchSepTop = document.createElement("div");
    branchSepTop.className = "menu-separator menu-dynamic";
    dropdown.insertBefore(branchSepTop, refNode);

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

  }

  renderSettingsMenuItems(dropdown, refNode);
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

async function runJob(jobName = null, argsOverride = null, workspaceOverride = null) {
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

  const workspace = workspaceOverride || selectedWorkspace;
  const args = argsOverride || collectArgs();
  const job = JOBS[targetJob] || {};
  const tabLabel = isTerminal && workspaceOverride ? workspaceOverride : (job.label || targetJob);

  for (const arg of (job.args || [])) {
    if (arg.required && !args[arg.name]) {
      showToast(`${tabLabel}: ${arg.name} の既定値がありません`);
      return;
    }
  }

  if (isTerminal) {
    launchingTerminal = true;
  } else {
    runningJobName = targetJob;
  }
  renderJobMenu();

  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job: targetJob, args, workspace }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }

    const data = await res.json();

    if (isTerminal && data.status === "ok" && data.ws_url) {
      addTerminalTab(data.ws_url, workspace);
      return;
    }

    if (data.status === "ok") {
      const stdout = data.stdout ? data.stdout.replace(/\n/g, " ").trim() : "";
      const msg = stdout ? `${tabLabel} 完了: ${stdout}`.slice(0, 200) : `${tabLabel} 完了`;
      showToast(msg, "success");
    } else {
      const detail = (data.stderr || data.stdout || `exit: ${data.exit_code}`).replace(/\n/g, " ").trim();
      showToast(`${tabLabel} 失敗: ${detail}`.slice(0, 200));
    }
  } catch (e) {
    showToast(`${tabLabel} エラー: ${e.message}`);
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

function switchItemCreateType(type) {
  $("item-create-link-form").style.display = type === "link" ? "" : "none";
  $("item-create-job-form").style.display = type === "job" ? "" : "none";
  $("item-create-error").style.display = "none";
  $("item-create-submit").textContent = type === "link" ? "追加" : "作成";
}

function getItemCreateType() {
  const checked = document.querySelector('input[name="item-create-type"]:checked');
  return checked ? checked.value : "link";
}

let selectedLinkIcon = "";
let selectedLinkIconColor = "";
let selectedJobIcon = "";
let selectedJobIconColor = "";

function setIconSelectPreview(btnId, iconClass, iconColor) {
  const btn = $(btnId);
  const preview = btn.querySelector(".icon-select-preview");
  if (iconClass) {
    const colorStyle = iconColor ? ` style="color: ${iconColor}"` : "";
    preview.innerHTML = `<span class="mdi ${iconClass}"${colorStyle}></span> ${iconClass}`;
  } else {
    preview.textContent = "未設定";
  }
}

function openItemCreateModal(workspace, type) {
  const modal = $("item-create-modal");
  modal.dataset.workspace = workspace || selectedWorkspace;
  $("link-create-label").value = "";
  $("link-create-url").value = "";
  $("job-create-name").value = "";
  $("job-create-label").value = "";
  $("job-create-script").value = "";
  $("item-create-error").style.display = "none";
  selectedLinkIcon = "";
  selectedLinkIconColor = "";
  selectedJobIcon = "";
  selectedJobIconColor = "";
  setIconSelectPreview("link-icon-select-btn", "");
  setIconSelectPreview("job-icon-select-btn", "");
  const radios = document.querySelectorAll('input[name="item-create-type"]');
  for (const r of radios) r.checked = r.value === type;
  switchItemCreateType(type);
  modal.style.display = "flex";
}

function openJobCreateModal() {
  openItemCreateModal(selectedWorkspace, "job");
}

function openLinkCreateModal(workspace) {
  openItemCreateModal(workspace, "link");
}

function closeItemCreateModal() {
  $("item-create-modal").style.display = "none";
}

function closeJobCreateModal() {
  closeItemCreateModal();
}

function closeLinkCreateModal() {
  closeItemCreateModal();
}

async function submitItemCreate() {
  const type = getItemCreateType();
  if (type === "link") {
    await submitLinkCreate();
  } else {
    await submitJobCreate();
  }
}

async function submitJobCreate() {
  const workspace = $("item-create-modal").dataset.workspace;
  const name = $("job-create-name").value.trim();
  const label = $("job-create-label").value.trim();
  const script = $("job-create-script").value;
  const errorEl = $("item-create-error");

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
    const res = await fetch(`/workspaces/${encodeURIComponent(workspace)}/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, label: label || name, script, icon: selectedJobIcon, icon_color: selectedJobIconColor }),
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
    closeItemCreateModal();
    await loadJobsForWorkspace();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

async function submitLinkCreate() {
  const workspace = $("item-create-modal").dataset.workspace;
  const label = $("link-create-label").value.trim();
  const url = $("link-create-url").value.trim();
  const errorEl = $("item-create-error");

  if (!url) {
    errorEl.textContent = "URLを入力してください";
    errorEl.style.display = "block";
    return;
  }

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(workspace)}/links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label, url, icon: selectedLinkIcon, icon_color: selectedLinkIconColor }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.detail || "追加に失敗しました";
      errorEl.style.display = "block";
      return;
    }
    closeItemCreateModal();
    showToast("リンクを追加しました", "success");
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

async function deleteLink(workspace, index, label) {
  if (!confirm(`リンク '${label}' を削除しますか？`)) return;
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(workspace)}/links/${index}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || "削除に失敗しました");
      return;
    }
    showToast("リンクを削除しました", "success");
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
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
      showToast(data.detail || "削除に失敗しました");
      return;
    }
    if (selectedJob === jobName) selectedJob = null;
    await loadJobsForWorkspace();
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
  }
}
