Object.assign(GitLogModal, {
  async openLocalBranchPane() {
    GitLogModal.previousModalTab = "commits";
    GitLogModal.showSubPane("commit-modal-tab-branch", "ブランチ");
    const listEl = $("branch-pane-list");
    listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';

    await GitCore.loadBranches();

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
          GitLogModal.closeSubPane();
          await GitCore.checkoutBranch(b);
          GitLogModal.updateGitLogBranchLabel();
          await GitLogModal.reloadGitLog();
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
          await GitLogModal.deleteBranch(b, false, delBtn);
        });
        actions.appendChild(delBtn);
        item.appendChild(actions);
      }

      listEl.appendChild(item);
    }

    const remoteBtn = document.createElement("div");
    remoteBtn.className = "branch-item branch-item-action";
    remoteBtn.textContent = "リモートブランチを表示...";
    remoteBtn.addEventListener("click", () => GitLogModal.openRemoteBranchPane());
    listEl.appendChild(remoteBtn);
  },

  async openStashPane() {
    if (!selectedWorkspace) return;

    GitLogModal.previousModalTab = "commits";
    GitLogModal.showSubPane("commit-modal-tab-stash", "Stash");
    const listEl = $("stash-pane-list");
    setCloneRepoStatus(listEl, "loading", "読み込み中...");

    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
      if (!res || !res.ok) {
        setCloneRepoStatus(listEl, "error", "取得に失敗しました");
        return;
      }
      const data = await res.json();
      if (data.status !== "ok" || !data.entries || data.entries.length === 0) {
        setCloneRepoStatus(listEl, "empty", "stashはありません");
        return;
      }
      listEl.innerHTML = "";
      for (const entry of data.entries) {
        const row = document.createElement("div");
        row.className = "stash-entry";

        const info = document.createElement("div");
        info.className = "stash-entry-info";
        info.style.cursor = "pointer";
        info.addEventListener("click", () => openCommitDiffModal(entry.ref, `Stash: ${entry.message}`));
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
        popBtn.addEventListener("click", () => GitLogModal.execStashRefAction("pop", entry.ref));
        actions.appendChild(popBtn);

        const dropBtn = document.createElement("button");
        dropBtn.type = "button";
        dropBtn.className = "commit-action-item commit-action-danger";
        dropBtn.textContent = "drop";
        dropBtn.addEventListener("click", () => GitLogModal.execStashRefAction("drop", entry.ref));
        actions.appendChild(dropBtn);

        row.appendChild(actions);
        listEl.appendChild(row);
      }
    } catch (e) {
      setCloneRepoStatus(listEl, "error", e.message);
    }
  },

  async execStashRefAction(action, ref) {
    if (!selectedWorkspace) return;
    const label = action === "pop" ? `stash pop ${ref}` : `stash drop ${ref}`;
    if (!confirm(`${label} を実行しますか？`)) return;
    const endpoint = action === "pop" ? "stash-pop-index" : "stash-drop";
    await postWorkspaceAction(
      selectedWorkspace,
      `/${endpoint}`,
      label,
      { stash_ref: ref },
    );
    GitLogModal.closeSubPane();
    await GitCore.refreshAfterGitOp();
    await GitLogModal.reloadGitLog();
  },

  async openRemoteBranchPane() {
    GitLogModal.previousModalTab = "commits";
    GitLogModal.showSubPane("commit-modal-tab-branch", "リモートブランチ");
    const listEl = $("branch-pane-list");
    setCloneRepoStatus(listEl, "loading", "読み込み中...");

    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/branches/remote"));
      if (!res) return;
      if (!res.ok) {
        setCloneRepoStatus(listEl, "error", "取得に失敗しました");
        return;
      }
      const remoteBranches = await res.json();
      if (remoteBranches.length === 0) {
        setCloneRepoStatus(listEl, "empty", "リモートブランチがありません");
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
            GitLogModal.closeSubPane();
            await GitCore.checkoutBranch(branch);
            GitLogModal.updateGitLogBranchLabel();
            await GitLogModal.reloadGitLog();
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
            await GitLogModal.deleteBranch(branch, true, delBtn);
          });
          actions.appendChild(delBtn);
          item.appendChild(actions);
        }

        listEl.appendChild(item);
      }
    } catch (e) {
      setCloneRepoStatus(listEl, "error", e.message);
    }
  },

  async deleteBranch(branch, remote, triggerBtn) {
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
      await GitLogModal.openRemoteBranchPane();
    } else {
      await GitLogModal.openLocalBranchPane();
    }
  },
});
