// @ts-check
import { selectedWorkspace, allWorkspaces, cachedBranches } from './state-core.js';
import { apiFetch, workspaceApiPath, postWorkspaceAction, getActionFailureMessage, setListStatus } from './api-client.js';
import { $, showToast, escapeHtml } from './utils.js';
import { GitCore } from './git.js';
import { GitLogModal } from './git-log-modal.js';
import { openCommitDiffModal } from './git-diff.js';

Object.assign(GitLogModal, {
  _remoteBranchesExpanded: false,
  _renderingBranches: false,

  /**
   * Checks out the given branch and reloads the git log.
   * @param {string} branch
   * @returns {Promise<void>}
   */
  async selectBranch(branch) {
    GitLogModal.closeSubPane();
    await GitCore.checkoutBranch(branch);
    await GitLogModal.reloadGitLog();
  },

  /**
   * Creates a list item element for a branch.
   * @param {string} branch
   * @param {string | null} currentBranch
   * @param {{ remote?: boolean }} [options]
   * @returns {HTMLDivElement}
   */
  createBranchListItem(branch, currentBranch, { remote = false } = {}) {
    const item = document.createElement("div");
    item.className = `branch-item${remote ? " remote-only" : ""}`;
    if (branch === currentBranch) item.classList.add("current");

    const nameEl = document.createElement("div");
    nameEl.className = "branch-item-name";
    nameEl.textContent = branch === currentBranch ? `${branch} ✓` : branch;
    if (branch !== currentBranch) {
      nameEl.addEventListener("click", () => GitLogModal.selectBranch(branch));
    }
    item.appendChild(nameEl);

    if (branch !== currentBranch) {
      const actions = document.createElement("div");
      actions.className = "branch-item-actions";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "commit-action-item commit-action-danger";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        GitLogModal.deleteBranch(branch, remote, delBtn, item);
      });
      actions.appendChild(delBtn);
      item.appendChild(actions);
    }

    return item;
  },

  /**
   * Opens the local branch sub-pane and renders the branch list.
   * @returns {Promise<void>}
   */
  async openLocalBranchPane() {
    GitLogModal.showSubPane("branch", "ブランチ");
    GitLogModal._remoteBranchesExpanded = false;
    await GitLogModal.renderBranchList();
    GitLogModal.backgroundFetch();
  },

  /**
   * Renders the list of local (and optionally remote) branches.
   * @returns {Promise<void>}
   */
  async renderBranchList() {
    if (GitLogModal._renderingBranches) return;
    GitLogModal._renderingBranches = true;
    try {
      const listEl = $("git-branch-list");
      if (!listEl) return;

      await GitCore.loadBranches();
      const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
      const currentBranch = ws ? ws.branch : null;

      listEl.innerHTML = "";
      const sorted = currentBranch
        ? [currentBranch, ...cachedBranches.filter((b) => b !== currentBranch)]
        : cachedBranches;
      for (const b of sorted) {
        listEl.appendChild(GitLogModal.createBranchListItem(b, currentBranch));
      }

      if (GitLogModal._remoteBranchesExpanded) {
        const loading = document.createElement("div");
        loading.className = "branch-item branch-item-action clone-repo-loading";
        loading.textContent = "読み込み中...";
        listEl.appendChild(loading);
        await GitLogModal.renderRemoteBranches(listEl, currentBranch);
        loading.remove();
      } else {
        const remoteBtn = document.createElement("div");
        remoteBtn.className = "branch-item branch-item-action";
        remoteBtn.textContent = "リモートブランチを表示...";
        remoteBtn.addEventListener("click", async () => {
          GitLogModal._remoteBranchesExpanded = true;
          remoteBtn.textContent = "読み込み中...";
          remoteBtn.classList.add("clone-repo-loading");
          remoteBtn.style.pointerEvents = "none";
          await GitLogModal.renderBranchList();
        });
        listEl.appendChild(remoteBtn);
      }
    } finally {
      GitLogModal._renderingBranches = false;
    }
  },

  /**
   * Fetches and renders remote-only branches into the given list element.
   * @param {HTMLElement} listEl
   * @param {string | null} currentBranch
   * @returns {Promise<void>}
   */
  async renderRemoteBranches(listEl, currentBranch) {
    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/branches/remote"));
      if (!res || !res.ok) return;
      const remoteBranches = await res.json();
      const remoteOnly = remoteBranches.filter((b) => !cachedBranches.includes(b));
      for (const branch of remoteOnly) {
        listEl.appendChild(GitLogModal.createBranchListItem(branch, currentBranch, { remote: true }));
      }
    } catch {}
  },

  /**
   * Runs a background git fetch and refreshes the branch list on success.
   * @returns {Promise<void>}
   */
  async backgroundFetch() {
    if (GitLogModal._fetchingInBackground) return;
    GitLogModal._fetchingInBackground = true;
    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/fetch"), { method: "POST" });
      if (!res || !res.ok) return;
      const data = await res.json();
      if (data.status === "ok") {
        await GitLogModal.renderBranchList();
      }
    } catch {} finally {
      GitLogModal._fetchingInBackground = false;
    }
  },

  /**
   * Deletes the specified branch (local or remote) after confirmation.
   * @param {string} branch
   * @param {boolean} remote
   * @param {HTMLButtonElement | null} triggerBtn
   * @param {HTMLElement | null} itemEl
   * @returns {Promise<void>}
   */
  async deleteBranch(branch, remote, triggerBtn, itemEl) {
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
        if (itemEl) {
          itemEl.remove();
          if (!remote) await GitCore.loadBranches();
          return;
        }
      } else {
        showToast(`削除失敗: ${getActionFailureMessage(data, "unknown error")}`);
      }
    } catch (e) {
      showToast(`削除エラー: ${e.message}`);
    } finally {
      if (triggerBtn) {
        triggerBtn.classList.remove("running");
        triggerBtn.disabled = false;
      }
    }
    await GitLogModal.renderBranchList();
  },

  /**
   * Opens the stash sub-pane and renders the stash list.
   * @returns {Promise<void>}
   */
  async openStashPane() {
    if (!selectedWorkspace) return;
    GitLogModal.showSubPane("stash", "Stash");
    $("stash-save-btn").onclick = () => GitLogModal.execStashSave();
    const listEl = $("git-stash-list");
    setListStatus(listEl, "loading", "読み込み中...");

    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
      if (!res || !res.ok) {
        setListStatus(listEl, "error", "取得に失敗しました");
        return;
      }
      const data = await res.json();
      if (data.status !== "ok" || !data.entries || data.entries.length === 0) {
        setListStatus(listEl, "empty", "stashはありません");
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
        popBtn.textContent = "適用";
        popBtn.addEventListener("click", () => GitLogModal.execStashRefAction("pop", entry.ref));
        actions.appendChild(popBtn);

        const dropBtn = document.createElement("button");
        dropBtn.type = "button";
        dropBtn.className = "commit-action-item commit-action-danger";
        dropBtn.textContent = "削除";
        dropBtn.addEventListener("click", () => GitLogModal.execStashRefAction("drop", entry.ref));
        actions.appendChild(dropBtn);

        row.appendChild(actions);
        listEl.appendChild(row);
      }
    } catch (e) {
      setListStatus(listEl, "error", e.message);
    }
  },

  /**
   * Prompts the user and executes a stash save, then refreshes the stash pane.
   * @returns {Promise<void>}
   */
  async execStashSave() {
    if (!selectedWorkspace) return;
    if (!confirm("stash save を実行しますか？")) return;
    await postWorkspaceAction(
      selectedWorkspace,
      "/stash",
      "stash",
      { include_untracked: true },
    );
    await GitCore.refreshAfterGitOp();
    await GitLogModal.openStashPane();
  },

  /**
   * Prompts the user and executes a stash pop or drop for the given ref.
   * @param {"pop" | "drop"} action
   * @param {string} ref
   * @returns {Promise<void>}
   */
  async execStashRefAction(action, ref) {
    if (!selectedWorkspace) return;
    const actionLabel = action === "pop" ? "適用" : "削除";
    const confirmLabel = `stash ${actionLabel} ${ref}`;
    if (!confirm(`${confirmLabel} を実行しますか？`)) return;
    const endpoint = action === "pop" ? "stash-pop-ref" : "stash-drop";
    await postWorkspaceAction(
      selectedWorkspace,
      `/${endpoint}`,
      `stash ${action} ${ref}`,
      { stash_ref: ref },
    );
    GitLogModal.closeSubPane();
    await GitCore.refreshAfterGitOp();
    await GitLogModal.reloadGitLog();
  },
});
