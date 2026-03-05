// @ts-check
import { openTabs, splitMode, allWorkspaces, selectedWorkspace, setSelectedWorkspace, appInitializing, workspaceJobsLoadedFor } from './state-core.js';
import { $ } from './utils.js';
import { resolveWorkspaceNameForTab } from './terminal-tab-utils.js';
import { refreshWorkspaceHeader, refreshCurrentWorkspaceStatus } from './workspace.js';
import { loadJobsForWorkspace } from './jobs.js';
import { GitLogModal } from './git-log-modal.js';

/**
 * Synchronizes the selected workspace state to match the given tab ID.
 * @param {string|null} id
 * @returns {void}
 */
export function syncWorkspaceForTab(id) {
  if (splitMode || id === null) {
    setSelectedWorkspace(null);
    return;
  }
  const tab = openTabs.find((t) => t.id === id);
  if (!tab) { setSelectedWorkspace(null); return; }
  const workspaceName = resolveWorkspaceNameForTab(tab);
  if (!workspaceName) { setSelectedWorkspace(null); return; }
  const ws = allWorkspaces.find((w) => w.name === workspaceName);
  if (ws) {
    setSelectedWorkspace(ws.name);
    return;
  }
  setSelectedWorkspace(workspaceName);
}

/** @type {number} */
export let _headerUpdateSeq = 0;

/**
 * Updates the header UI to reflect the active tab's workspace.
 * @param {string|null} id
 * @returns {Promise<void>}
 */
export async function updateHeaderForTab(id) {
  if (appInitializing) return;
  const seq = ++_headerUpdateSeq;

  if (splitMode || id === null) {
    setSelectedWorkspace(null);
    updateGitBarVisibility();
    await Promise.all([
      refreshWorkspaceHeader({ reloadBranches: false }),
      loadJobsForWorkspace(),
    ]);
    return;
  }

  const activeTab = openTabs.find((t) => t.id === id);
  const workspaceName = resolveWorkspaceNameForTab(activeTab);
  if (!workspaceName) {
    setSelectedWorkspace(null);
    updateGitBarVisibility();
    return;
  }
  const ws = allWorkspaces.find((w) => w.name === workspaceName);
  const nextWorkspace = ws ? ws.name : workspaceName;
  const workspaceChanged = selectedWorkspace !== nextWorkspace;
  setSelectedWorkspace(nextWorkspace);
  updateGitBarVisibility();
  const shouldReloadJobs = workspaceChanged || workspaceJobsLoadedFor !== nextWorkspace;
  const tasks = [refreshWorkspaceHeader({ reloadBranches: workspaceChanged })];
  if (shouldReloadJobs) tasks.push(loadJobsForWorkspace(workspaceChanged));
  await Promise.all(tasks);
  if (seq !== _headerUpdateSeq) return;
  refreshCurrentWorkspaceStatus();
}

/**
 * Shows or hides the git bar in the header based on current state.
 * @returns {void}
 */
export function updateGitBarVisibility() {
  const show = selectedWorkspace && !splitMode;
  $("header-row2").style.display = show ? "flex" : "none";
  if (!show) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const isGitRepo = ws && ws.is_git_repo === true;
  const hasUpstream = ws ? ws.has_upstream !== false : true;
  $("header-commit-msg").style.display = isGitRepo ? "" : "none";
  $("main-git-status").style.display = isGitRepo ? "" : "none";
  $("git-actions").style.display = isGitRepo && (ws.behind > 0 || ws.ahead > 0 || !hasUpstream) ? "flex" : "none";
  let hint = $("non-git-hint");
  if (!isGitRepo) {
    if (!hint) {
      hint = document.createElement("button");
      hint.id = "non-git-hint";
      hint.className = "non-git-hint commit-msg-btn";
      hint.textContent = "Gitリポジトリではありません";
      hint.onclick = () => GitLogModal.openFileModal();
      $("header-row2").appendChild(hint);
    }
    hint.style.display = "";
  } else if (hint) {
    hint.style.display = "none";
  }
}
