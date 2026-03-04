// @ts-check
import { selectedWorkspace, workspaceJobs, setWorkspaceJobs, workspaceJobsCache, setWorkspaceJobsCache, workspaceJobsLoadedFor, setWorkspaceJobsLoadedFor, pendingJob, setPendingJob, allWorkspaces, isLaunchingTerminal, setIsLaunchingTerminal } from './state-core.js';
import { apiFetch, workspaceApiPath, getActionFailureMessage } from './api-client.js';
import { $, escapeHtml, showToast } from './utils.js';
import { renderTabBar, addTerminalTab } from './terminal-tabs.js';

/**
 * @param {string|null} workspace
 * @returns {Record<string,any>|null}
 */
export function getCachedJobsForWorkspace(workspace) {
  if (!workspace) return null;
  if (!Object.prototype.hasOwnProperty.call(workspaceJobsCache, workspace)) return null;
  return workspaceJobsCache[workspace];
}

/**
 * @param {string|null} workspace
 * @param {Record<string,any>|null} jobs
 */
export function setCachedJobsForWorkspace(workspace, jobs) {
  if (!workspace) return;
  workspaceJobsCache[workspace] = jobs || {};
}

/**
 * @param {string|null} [workspace]
 */
export function invalidateWorkspaceJobsCache(workspace) {
  if (!workspace) {
    setWorkspaceJobsCache({});
    setWorkspaceJobsLoadedFor(null);
    return;
  }
  delete workspaceJobsCache[workspace];
  if (workspaceJobsLoadedFor === workspace) {
    setWorkspaceJobsLoadedFor(null);
  }
}

/**
 * @param {boolean} [force]
 * @returns {Promise<void>}
 */
export async function loadJobsForWorkspace(force = false) {
  if (!selectedWorkspace) {
    setWorkspaceJobs({});
    setWorkspaceJobsLoadedFor(null);
    setPendingJob(null);
    $("output").innerHTML = '<div class="empty-state"></div>';
    return;
  }

  const targetWorkspace = selectedWorkspace;
  const cachedJobs = getCachedJobsForWorkspace(targetWorkspace);
  if (!force && cachedJobs) {
    setWorkspaceJobs(cachedJobs);
    setWorkspaceJobsLoadedFor(targetWorkspace);
    setPendingJob(null);
    renderTabBar();
    return;
  }
  if (!force && workspaceJobsLoadedFor === targetWorkspace) {
    setPendingJob(null);
    renderTabBar();
    return;
  }

  try {
    const res = await apiFetch(workspaceApiPath(targetWorkspace, "/jobs"));
    if (!res || !res.ok) {
      if (selectedWorkspace !== targetWorkspace) return;
      if (cachedJobs) {
        setWorkspaceJobs(cachedJobs);
        setWorkspaceJobsLoadedFor(targetWorkspace);
      } else {
        setWorkspaceJobs({});
        setWorkspaceJobsLoadedFor(null);
      }
    } else {
      const jobs = await res.json();
      if (selectedWorkspace !== targetWorkspace) return;
      setWorkspaceJobs(jobs);
      setCachedJobsForWorkspace(targetWorkspace, jobs);
      setWorkspaceJobsLoadedFor(targetWorkspace);
    }
  } catch (e) {
    console.error("loadJobsForWorkspace failed:", e);
    if (selectedWorkspace !== targetWorkspace) return;
    if (cachedJobs) {
      setWorkspaceJobs(cachedJobs);
      setWorkspaceJobsLoadedFor(targetWorkspace);
    } else {
      setWorkspaceJobs({});
      setWorkspaceJobsLoadedFor(null);
    }
  }

  setPendingJob(null);
  renderTabBar();
}

/**
 * @param {string} workspace
 * @param {string} jobName
 * @returns {Promise<Record<string,any>|null>}
 */
export async function fetchWorkspaceJobDetail(workspace, jobName) {
  if (!workspace || !jobName || jobName === "terminal") return null;
  try {
    const res = await apiFetch(workspaceApiPath(workspace, `/jobs/${encodeURIComponent(jobName)}`));
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("fetchWorkspaceJobDetail failed:", e);
    return null;
  }
}

/**
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function openJobConfirmModal(name) {
  const job = workspaceJobs[name];
  if (!job) return;
  setPendingJob(name);
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
    let detail = job;
    if (!detail.command && selectedWorkspace) {
      const fetched = await fetchWorkspaceJobDetail(selectedWorkspace, name);
      if (fetched) {
        workspaceJobs[name] = { ...job, ...fetched };
        setCachedJobsForWorkspace(selectedWorkspace, workspaceJobs);
        detail = workspaceJobs[name];
      }
    }
    if (detail.command) {
      const preview = escapeHtml(detail.command.length > 300 ? detail.command.slice(0, 300) + "..." : detail.command);
      argsContainer.innerHTML = `<pre class="script-preview">${preview}</pre>`;
    }
  }

  $("job-confirm-modal").style.display = "flex";
}

/**
 * @returns {void}
 */
export function closeJobConfirmModal() {
  $("job-confirm-modal").style.display = "none";
}

/**
 * @returns {Record<string,string>}
 */
export function collectConfirmArgs() {
  const job = workspaceJobs[pendingJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    const checked = document.querySelector(`input[name="confirm-arg-${CSS.escape(arg.name)}"]:checked`);
    if (checked) args[arg.name] = /** @type {HTMLInputElement} */ (checked).value;
  }
  return args;
}

/** @type {Promise<void>} */
export let jobExecutionQueue = Promise.resolve();

/**
 * @param {Record<string,any>|null} jobs
 * @param {string} identifier
 * @returns {{ key: string, job: Record<string,any>|null }}
 */
export function resolveJobByNameOrLabel(jobs, identifier) {
  if (!jobs || identifier === "terminal") return { key: identifier, job: null };
  if (jobs[identifier]) return { key: identifier, job: jobs[identifier] };
  for (const [name, def] of Object.entries(jobs)) {
    if ((def.label || name) === identifier) {
      return { key: name, job: def };
    }
  }
  return { key: identifier, job: null };
}

/**
 * @param {string|null} [jobName]
 * @param {Record<string,string>|null} [argsOverride]
 * @param {string|null} [workspaceOverride]
 * @returns {Promise<void>}
 */
export async function runJob(jobName = null, argsOverride = null, workspaceOverride = null) {
  const targetJob = jobName || pendingJob;
  if (!targetJob) return Promise.resolve();
  if (pendingJob !== targetJob) {
    setPendingJob(targetJob);
  }
  const runPromise = jobExecutionQueue.then(() => executeJobInTerminal(targetJob, workspaceOverride));
  jobExecutionQueue = runPromise.catch((e) => {
    console.error("runJob queue failed:", e);
  });
  return runPromise;
}

/**
 * @param {string} targetJob
 * @param {string|null} workspaceOverride
 * @returns {Promise<void>}
 */
export async function executeJobInTerminal(targetJob, workspaceOverride) {
  const workspace = workspaceOverride || selectedWorkspace;
  let resolvedJobKey = targetJob;
  let job = null;

  if (targetJob !== "terminal") {
    const localResolved = resolveJobByNameOrLabel(workspaceJobs, targetJob);
    resolvedJobKey = localResolved.key;
    job = localResolved.job;
  }

  if (!job && targetJob !== "terminal" && workspace) {
    const cachedWorkspaceJobs = getCachedJobsForWorkspace(workspace);
    if (cachedWorkspaceJobs) {
      const cachedResolved = resolveJobByNameOrLabel(cachedWorkspaceJobs, targetJob);
      resolvedJobKey = cachedResolved.key;
      job = cachedResolved.job;
    }
  }

  if (!job && targetJob !== "terminal" && workspace) {
    try {
      const jobsRes = await apiFetch(workspaceApiPath(workspace, "/jobs"));
      if (jobsRes && jobsRes.ok) {
        const wsJobs = await jobsRes.json();
        setCachedJobsForWorkspace(workspace, wsJobs);
        const fetchedResolved = resolveJobByNameOrLabel(wsJobs, targetJob);
        resolvedJobKey = fetchedResolved.key;
        job = fetchedResolved.job;
      }
    } catch (e) {
      console.error("job fetch failed:", e);
    }
  }
  if (!job && targetJob !== "terminal") {
    showToast(`ジョブ "${targetJob}" が見つかりません`);
    return;
  }

  if (resolvedJobKey !== "terminal" && !job.command && workspace) {
    const detailed = await fetchWorkspaceJobDetail(workspace, resolvedJobKey);
    if (detailed) {
      job = { ...job, ...detailed };
      const existingWorkspaceJobs = getCachedJobsForWorkspace(workspace) || {};
      existingWorkspaceJobs[resolvedJobKey] = job;
      setCachedJobsForWorkspace(workspace, existingWorkspaceJobs);
      if (workspace === selectedWorkspace) {
        workspaceJobs[resolvedJobKey] = job;
      }
    }
  }

  if (resolvedJobKey !== "terminal" && job.terminal === false) {
    await executeJobDirect(resolvedJobKey, job, workspace);
    return;
  }

  const tabLabel = resolvedJobKey === "terminal" ? (workspaceOverride || workspace) : (job.label || resolvedJobKey);

  let initialCommand = null;
  let tabIcon = null;
  let wsIcon = null;
  const ws = allWorkspaces.find((w) => w.name === workspace);
  const wsIconObj = ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : { name: "mdi-console", color: "" };
  if (resolvedJobKey === "terminal") {
    tabIcon = wsIconObj;
  } else if (job.command) {
    initialCommand = job.command;
    tabIcon = { name: job.icon || "mdi-play", color: job.icon_color || "" };
    wsIcon = wsIconObj;
  }

  setIsLaunchingTerminal(true);

  try {
    const requestedJobName = resolvedJobKey !== "terminal" ? resolvedJobKey : null;
    const requestedJobLabel = resolvedJobKey !== "terminal" ? (job.label || resolvedJobKey) : null;
    const res = await apiFetch("/run", {
      method: "POST",
      body: {
        job: "terminal",
        args: {},
        workspace,
        icon: tabIcon?.name,
        icon_color: tabIcon?.color,
        job_name: requestedJobName,
        job_label: requestedJobLabel,
      },
    });
    if (!res) return;

    const data = await res.json();
    if (data.status !== "ok" || !data.ws_url) {
      showToast(`${tabLabel} エラー: ターミナル作成に失敗`);
      return;
    }

    addTerminalTab(data.ws_url, workspace, null, false, false, initialCommand, tabIcon, wsIcon, requestedJobName, requestedJobLabel);

  } catch (e) {
    showToast(`${tabLabel} エラー: ${e.message}`);
  } finally {
    setIsLaunchingTerminal(false);
  }
}

/**
 * @param {string} targetJob
 * @param {Record<string,any>} job
 * @param {string|null} workspace
 * @returns {Promise<void>}
 */
export async function executeJobDirect(targetJob, job, workspace) {
  const label = job.label || targetJob;
  try {
    const res = await apiFetch("/run", {
      method: "POST",
      body: { job: targetJob, args: collectConfirmArgs(), workspace },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status === "error" || data.exit_code !== 0) {
      showToast(getActionFailureMessage(data, "失敗"));
    } else {
      const msg = (data.stdout || "完了").slice(0, 200);
      showToast(`${label}: ${msg}`, "success");
    }
  } catch (e) {
    showToast(`${label}: ${e.message}`);
  }
}
