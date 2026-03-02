const GitCore = {
  async refreshAfterGitOp() {
    await loadWorkspaces();
    await refreshWorkspaceHeader();
  },


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

  async gitPull() {
    await GitCore.executeGitRemoteOp("pull-btn", "/pull", "pull");
  },

  async gitSetUpstream() {
    await GitCore.executeGitRemoteOp("set-upstream-btn", "/set-upstream", "追跡設定");
  },

  async gitPushUpstream() {
    await GitCore.executeGitRemoteOp("push-upstream-btn", "/push-upstream", "push");
  },

  async gitPush() {
    await GitCore.executeGitRemoteOp("push-btn", "/push", "push");
  },

  async loadBranches() {
    cachedBranches = [];
    if (!selectedWorkspace) return;

    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/branches"));
      if (!res || !res.ok) return;
      cachedBranches = await res.json();
    } catch (e) {
      console.warn("loadBranches failed:", e);
    }
  },

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
        const msg = data.detail || data.stderr || data.stdout || "checkout に失敗しました";
        showToast(msg);
      }
    } catch (e) {
      showToast(`checkout エラー: ${e.message}`);
    }
  },

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
          GitLogModal.closeGitLogModal();
          await GitCore.refreshAfterGitOp();
        },
      }));
  },

  buildCommitActions(hash, { branches = [], checkoutBranchFn, extraActions = [] } = {}) {
    const switchActions = GitCore.buildBranchSwitchActions(branches);
    return [
      ...switchActions,
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
    GitLogModal.closeGitLogModal();
    await GitCore.refreshAfterGitOp();
  },

  execCommitResetAction(hash, mode) {
    const shortHash = hash.substring(0, 8);
    const confirmMsg = mode === "hard"
      ? `reset --hard ${shortHash} を実行します。作業ツリーの変更はすべて失われます。実行しますか？`
      : `reset --soft ${shortHash} を実行しますか？`;
    return GitCore.execCommitAction("reset", hash, { commit_hash: hash, mode }, confirmMsg);
  },

  async execStashAction(action) {
    if (!selectedWorkspace) return;
    const endpoint = action === "pop" ? "stash-pop" : "stash";
    const label = action === "pop" ? "stash pop" : "stash";
    if (!confirm(`${label} を実行しますか？`)) return;
    const body = action === "pop" ? null : { include_untracked: true };
    await postWorkspaceAction(selectedWorkspace, `/${endpoint}`, label, body);
    GitLogModal.closeGitLogModal();
    await GitCore.refreshAfterGitOp();
  },
};
