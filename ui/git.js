// @ts-check
import { selectedWorkspace, allWorkspaces, cachedBranches, setCachedBranches } from './state-core.js';
import { apiFetch, workspaceApiPath, postWorkspaceAction, getActionFailureMessage } from './api-client.js';
import { showToast, $ } from './utils.js';
import { refreshCurrentWorkspaceStatus } from './workspace.js';
import { GitLogModal } from './git-log-modal.js';

export const GitCore = {
  /**
   * Refresh the current workspace status after a git operation.
   * @returns {Promise<void>}
   */
  async refreshAfterGitOp() {
    await refreshCurrentWorkspaceStatus();
  },


  /**
   * Execute a git remote operation (pull, push, etc.) with confirmation.
   * @param {string} buttonId - The ID of the button element to disable during execution.
   * @param {string} endpoint - The workspace API endpoint suffix (e.g. "/pull").
   * @param {string} label - The human-readable label for the operation.
   * @returns {Promise<void>}
   */
  async executeGitRemoteOp(buttonId, endpoint, label) {
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
      await postWorkspaceAction(selectedWorkspace, endpoint, label);
    } finally {
      btn.classList.remove("running");
      btn.disabled = false;
      await GitCore.refreshAfterGitOp();
    }
  },

  /**
   * Execute git pull --rebase on the current workspace.
   * @returns {Promise<void>}
   */
  async gitPull() {
    await GitCore.executeGitRemoteOp("pull-btn", "/pull", "pull");
  },

  /**
   * Set upstream tracking branch for the current workspace.
   * @returns {Promise<void>}
   */
  async gitSetUpstream() {
    await GitCore.executeGitRemoteOp("set-upstream-btn", "/set-upstream", "追跡設定");
  },

  /**
   * Push to upstream (with upstream tracking) for the current workspace.
   * @returns {Promise<void>}
   */
  async gitPushUpstream() {
    await GitCore.executeGitRemoteOp("push-upstream-btn", "/push-upstream", "push");
  },

  /**
   * Execute git push on the current workspace.
   * @returns {Promise<void>}
   */
  async gitPush() {
    await GitCore.executeGitRemoteOp("push-btn", "/push", "push");
  },

  /**
   * Load local branches for the current workspace into the cache.
   * @returns {Promise<void>}
   */
  async loadBranches() {
    setCachedBranches([]);
    if (!selectedWorkspace) return;

    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/branches"));
      if (!res || !res.ok) return;
      setCachedBranches(await res.json());
    } catch (e) {
      console.warn("loadBranches failed:", e);
    }
  },

  /**
   * Checkout a branch in the current workspace.
   * @param {string} branch - The branch name to checkout.
   * @returns {Promise<void>}
   */
  async checkoutBranch(branch) {
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
        await GitCore.refreshAfterGitOp();
      } else {
        showToast(getActionFailureMessage(data, "checkout に失敗しました"));
      }
    } catch (e) {
      showToast(`checkout エラー: ${e.message}`);
    }
  },

  /**
   * Build a list of branch switch actions for the git log modal.
   * @param {string[]} branches - List of branch names.
   * @param {(() => void) | null} [beforeSwitch] - Optional callback to call before switching.
   * @returns {{ label: string, cls: string, fn: () => Promise<void> }[]}
   */
  buildBranchSwitchActions(branches, beforeSwitch) {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    return branches
      .filter((b) => !ws || b !== ws.branch)
      .map((b) => ({
        label: `ブランチ変更: ${b}`,
        cls: "",
        fn: async () => {
          if (!confirm(`${b} に切り替えますか？`)) return;
          if (beforeSwitch) beforeSwitch();
          await GitCore.checkoutBranch(b);
          GitLogModal.closeGitModal();
          await GitCore.refreshAfterGitOp();
        },
      }));
  },

  /**
   * Build a list of merge actions for the git log modal.
   * @param {string[]} branches - List of branch names.
   * @returns {{ label: string, cls: string, fn: () => Promise<void> }[]}
   */
  buildMergeActions(branches) {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    return branches
      .filter((b) => !ws || b !== ws.branch)
      .map((b) => ({
        label: `merge: ${b}`,
        cls: "",
        fn: () => GitCore.execMergeAction(b),
      }));
  },

  /**
   * Execute git merge on the given branch with confirmation.
   * @param {string} branch - The branch to merge.
   * @returns {Promise<void>}
   */
  async execMergeAction(branch) {
    if (!selectedWorkspace) return;
    if (!confirm(`${branch} を現在のブランチにマージしますか？`)) return;
    await postWorkspaceAction(selectedWorkspace, "/merge", "merge", { branch });
    GitLogModal.closeGitModal();
    await GitCore.refreshAfterGitOp();
  },

  /**
   * Build the list of actions available for a given commit in the git log modal.
   * @param {string} hash - The commit hash.
   * @param {{ branches?: string[], checkoutBranchFn?: (() => void) | null, extraActions?: object[] }} [options]
   * @returns {object[]}
   */
  buildCommitActions(hash, { branches = [], checkoutBranchFn, extraActions = [] } = {}) {
    const switchActions = GitCore.buildBranchSwitchActions(branches);
    const mergeActions = GitCore.buildMergeActions(branches);
    return [
      ...switchActions,
      ...mergeActions,
      ...extraActions,
      {
        key: "create-branch",
        label: "ブランチ作成",
        cls: "",
        fn: checkoutBranchFn || (() => GitLogModal.toggleCreateBranchArea(hash)),
      },
      { label: "cherry-pick", cls: "", fn: () => GitCore.execCommitAction("cherry-pick", hash) },
      { label: "revert", cls: "", fn: () => GitCore.execCommitAction("revert", hash) },
      { label: "reset --soft", cls: "", fn: () => GitCore.execCommitResetAction(hash, "soft") },
      { label: "reset --hard", cls: "commit-action-danger", fn: () => GitCore.execCommitResetAction(hash, "hard") },
    ];
  },

  /**
   * Execute a commit-level git action (cherry-pick, revert, reset) with confirmation.
   * @param {string} action - The action name (e.g. "cherry-pick", "revert", "reset").
   * @param {string} hash - The commit hash to act on.
   * @param {object | null} [body] - Optional request body override.
   * @param {string | null} [confirmMsg] - Optional confirmation message override.
   * @returns {Promise<void>}
   */
  async execCommitAction(action, hash, body = null, confirmMsg = null) {
    if (!selectedWorkspace) return;
    const shortHash = hash.substring(0, 8);
    const msg = confirmMsg || `${action} ${shortHash} を実行しますか？`;
    if (!confirm(msg)) return;
    await postWorkspaceAction(
      selectedWorkspace,
      `/${action}`,
      action,
      body || { commit_hash: hash },
    );
    GitLogModal.closeGitModal();
    await GitCore.refreshAfterGitOp();
  },

  /**
   * Execute a git reset action (soft or hard) on the given commit hash.
   * @param {string} hash - The commit hash to reset to.
   * @param {"soft" | "hard"} mode - The reset mode.
   * @returns {Promise<void>}
   */
  execCommitResetAction(hash, mode) {
    const shortHash = hash.substring(0, 8);
    const confirmMsg = mode === "hard"
      ? `reset --hard ${shortHash} を実行します。作業ツリーの変更はすべて失われます。実行しますか？`
      : `reset --soft ${shortHash} を実行しますか？`;
    return GitCore.execCommitAction("reset", hash, { commit_hash: hash, mode }, confirmMsg);
  },

  /**
   * Execute a stash action (stash or stash pop) with confirmation.
   * @param {"push" | "pop"} action - The stash action to perform.
   * @returns {Promise<void>}
   */
  async execStashAction(action) {
    if (!selectedWorkspace) return;
    const endpoint = action === "pop" ? "stash-pop" : "stash";
    const label = action === "pop" ? "stash pop" : "stash";
    if (!confirm(`${label} を実行しますか？`)) return;
    const body = action === "pop" ? null : { include_untracked: true };
    await postWorkspaceAction(selectedWorkspace, `/${endpoint}`, label, body);
    GitLogModal.closeGitModal();
    await GitCore.refreshAfterGitOp();
  },
};
